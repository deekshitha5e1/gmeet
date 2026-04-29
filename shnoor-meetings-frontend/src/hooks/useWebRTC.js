import { useState, useEffect, useRef, useCallback } from 'react';
import {
  closeCallHistoryEntry,
  getPreJoinMediaState,
  getPreferredMediaConstraints,
  upsertCallHistoryEntry,
} from '../utils/meetingUtils';
import { buildWebSocketUrl } from '../utils/api';
import { getCurrentUser } from '../utils/currentUser';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function getStableClientId(roomId) {
  const currentUser = getCurrentUser();
  if (currentUser?.meetingUserId) {
    sessionStorage.setItem(`meeting_client_${roomId}`, currentUser.meetingUserId);
    return currentUser.meetingUserId;
  }

  const storageKey = `meeting_client_${roomId}`;
  const existingId = sessionStorage.getItem(storageKey);

  if (existingId) {
    return existingId;
  }

  const nextId = crypto.randomUUID();
  sessionStorage.setItem(storageKey, nextId);
  return nextId;
}

function getDisplayName(roomId, isHost) {
  const currentUser = getCurrentUser();
  const storageKey = `meeting_name_${roomId}`;
  const existingName = sessionStorage.getItem(storageKey);

  if (existingName) {
    return existingName;
  }

  const generatedName = currentUser?.name || (isHost ? 'Host' : `Participant ${getStableClientId(roomId).slice(-4).toUpperCase()}`);
  sessionStorage.setItem(storageKey, generatedName);
  return generatedName;
}

export function useWebRTC(roomId, options = {}) {
  const {
    acquireMedia = true,
    autoJoin = true,
    initialRole,
  } = options;

  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [messages, setMessages] = useState([]);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [participantsMetadata, setParticipantsMetadata] = useState({});
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [activeJoinRequests, setActiveJoinRequests] = useState([]);
  const initialMediaState = useRef(getPreJoinMediaState(roomId));
  const [isAudioEnabled, setIsAudioEnabled] = useState(initialMediaState.current.audioEnabled);
  const [isVideoEnabled, setIsVideoEnabled] = useState(initialMediaState.current.videoEnabled);
  const normalizedCurrentEmail = (getCurrentUser()?.email || '').trim().toLowerCase();
  const storedHostEmail = (localStorage.getItem(`meeting_host_${roomId}`) || '').trim().toLowerCase();
  const hasStoredHostAccess = Boolean(
    normalizedCurrentEmail &&
    storedHostEmail &&
    storedHostEmail === normalizedCurrentEmail
  );

  const computeIsHost = useCallback(() => (
    initialRole === 'host' ||
    (
      initialRole !== 'participant' &&
      sessionStorage.getItem(`meeting_role_${roomId}`) === 'host'
    ) ||
    (
      initialRole !== 'participant' &&
      !sessionStorage.getItem(`meeting_role_${roomId}`) &&
      hasStoredHostAccess
    )
  ), [hasStoredHostAccess, initialRole, roomId]);
  const [isHostState, setIsHostState] = useState(() => computeIsHost());
  const isHost = useRef(isHostState);
  const clientId = useRef(getStableClientId(roomId));
  const displayName = useRef(getDisplayName(roomId, isHostState));
  const currentUser = useRef(getCurrentUser());
  const ws = useRef(null);
  const peerConnections = useRef({});
  const originalStream = useRef(null);
  const activeStreamsRef = useRef([]);
  const joinedRoomRef = useRef(false);
  const activeSessionIdsRef = useRef({});
  const joinRoomCallbackRef = useRef(null);
  const handleSignalingDataRef = useRef(null);
  const pendingMessagesRef = useRef([]);

  const addMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const getSessionId = useCallback((participantId) => activeSessionIdsRef.current[participantId], []);

  const startSessionTracking = useCallback((participantId, name, role = 'participant') => {
    if (activeSessionIdsRef.current[participantId]) {
      return;
    }

    const sessionId = `${roomId}-${participantId}-${Date.now()}`;
    activeSessionIdsRef.current[participantId] = sessionId;

    upsertCallHistoryEntry({
      sessionId,
      roomId,
      participantId,
      name,
      role,
      entryTime: new Date().toISOString(),
    });
  }, [roomId]);

  const endSessionTracking = useCallback((participantId) => {
    const sessionId = getSessionId(participantId);

    if (!sessionId) {
      return;
    }

    closeCallHistoryEntry(sessionId);
    delete activeSessionIdsRef.current[participantId];
  }, [getSessionId]);

  const sendSignalingMessage = useCallback((msg) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
      return;
    }

    pendingMessagesRef.current.push(msg);
  }, []);

  const syncParticipantState = useCallback((extraState = {}) => {
    if (!joinedRoomRef.current) {
      return;
    }

    sendSignalingMessage({
      type: 'participant-update',
      name: displayName.current,
      picture: currentUser.current?.picture || null,
      role: isHost.current ? 'host' : 'participant',
      isHandRaised,
      isSharingScreen,
      ...extraState,
    });
  }, [isHandRaised, isSharingScreen, sendSignalingMessage]);

  const joinRoom = useCallback(() => {
    if (!autoJoin || joinedRoomRef.current || !ws.current || ws.current.readyState !== WebSocket.OPEN) {
      return;
    }

    joinedRoomRef.current = true;
    sessionStorage.setItem(`meeting_admitted_${roomId}`, 'true');

    setParticipantsMetadata((prev) => ({
      ...prev,
      [clientId.current]: {
        ...prev[clientId.current],
        name: displayName.current,
        picture: currentUser.current?.picture || null,
        role: isHost.current ? 'host' : 'participant',
        isHandRaised: false,
        isSharingScreen: false,
      },
    }));

    startSessionTracking(clientId.current, displayName.current, isHost.current ? 'host' : 'participant');

    sendSignalingMessage({
      type: 'join-room',
      user_id: clientId.current,
      firebase_uid: currentUser.current?.firebaseUid || null,
      email: currentUser.current?.email || null,
      name: displayName.current,
      picture: currentUser.current?.picture || null,
      role: isHost.current ? 'host' : 'participant',
      // Pass admitted flag so backend trusts already-approved participants
      admitted: !isHost.current && sessionStorage.getItem(`meeting_admitted_${roomId}`) === 'true',
      joined_at: new Date().toISOString(),
    });
  }, [autoJoin, roomId, sendSignalingMessage, startSessionTracking]);

  const createPeerConnection = useCallback((peerId, stream) => {
    if (!peerId) {
      return null;
    }

    if (peerConnections.current[peerId]) {
      return peerConnections.current[peerId];
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);

    // Add local tracks if we have them; otherwise add transceivers so we
    // can still receive remote tracks even when camera/mic is off.
    if (stream && stream.getTracks().length > 0) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.addTransceiver('video', { direction: 'recvonly' });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignalingMessage({
          type: 'ice-candidate',
          target: peerId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      setRemoteStreams((prev) => ({
        ...prev,
        [peerId]: event.streams[0],
      }));
    };

    peerConnections.current[peerId] = pc;
    return pc;
  }, [sendSignalingMessage]);

  const handleSignalingData = useCallback(async (data, stream) => {
    const { type, sender, target } = data;
    const peerId = sender || data.client_id;

    if (peerId === clientId.current) {
      return;
    }

    if (target && target !== clientId.current) {
      return;
    }

    switch (type) {
      case 'user-joined': {
        const stream_ = stream || originalStream.current;
        const pc = createPeerConnection(peerId, stream_);
        if (!pc) {
          return;
        }

        setParticipantsMetadata((prev) => ({
          ...prev,
          [peerId]: {
            ...prev[peerId],
            name: data.name || prev[peerId]?.name || 'Participant',
            picture: data.picture || prev[peerId]?.picture || null,
            role: data.role || prev[peerId]?.role || 'participant',
            isHandRaised: prev[peerId]?.isHandRaised || false,
            isSharingScreen: prev[peerId]?.isSharingScreen || false,
          },
        }));

        startSessionTracking(peerId, data.name || 'Participant', data.role || 'participant');

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignalingMessage({ type: 'offer', target: peerId, offer });
        syncParticipantState();
        break;
      }

      case 'offer': {
        const stream_ = stream || originalStream.current;
        const pcOffer = createPeerConnection(peerId, stream_);
        if (!pcOffer) {
          return;
        }

        await pcOffer.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pcOffer.createAnswer();
        await pcOffer.setLocalDescription(answer);
        sendSignalingMessage({ type: 'answer', target: peerId, answer });
        break;
      }

      case 'answer': {
        const pcAnswer = peerConnections.current[peerId];
        if (pcAnswer && pcAnswer.signalingState !== 'stable') {
          await pcAnswer.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
        break;
      }

      case 'ice-candidate': {
        const pcIce = peerConnections.current[peerId];
        if (pcIce) {
          try {
            await pcIce.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (error) {
            console.error('Error adding received ice candidate', error);
          }
        }
        break;
      }

      case 'user-left': {
        if (peerConnections.current[peerId]) {
          peerConnections.current[peerId].close();
          delete peerConnections.current[peerId];
        }

        setRemoteStreams((prev) => {
          const nextStreams = { ...prev };
          delete nextStreams[peerId];
          return nextStreams;
        });

        setParticipantsMetadata((prev) => {
          const nextMetadata = { ...prev };
          delete nextMetadata[peerId];
          return nextMetadata;
        });

        endSessionTracking(peerId);
        break;
      }

      case 'chat':
        addMessage({ sender: data.sender, text: data.text });
        break;

      case 'raise-hand':
        setParticipantsMetadata((prev) => ({
          ...prev,
          [peerId]: { ...prev[peerId], isHandRaised: true },
        }));
        break;

      case 'lower-hand':
        setParticipantsMetadata((prev) => ({
          ...prev,
          [peerId]: { ...prev[peerId], isHandRaised: false },
        }));
        break;

      case 'participant-update':
        setParticipantsMetadata((prev) => ({
          ...prev,
          [peerId]: {
            ...prev[peerId],
            name: data.name || prev[peerId]?.name || 'Participant',
            picture: data.picture || prev[peerId]?.picture || null,
            role: data.role || prev[peerId]?.role || 'participant',
            isHandRaised: typeof data.isHandRaised === 'boolean' ? data.isHandRaised : prev[peerId]?.isHandRaised,
            isSharingScreen: typeof data.isSharingScreen === 'boolean' ? data.isSharingScreen : prev[peerId]?.isSharingScreen,
          },
        }));
        break;

      case 'join-request':
      case 'join_request':
        if (isHost.current) {
          setActiveJoinRequests((prev) => {
            if (prev.find((request) => request.id === peerId)) {
              return prev;
            }

            return [
              ...prev,
              {
                id: peerId,
                name: data.name || 'Participant',
                picture: data.picture || null,
              },
            ];
          });
        }
        break;

      case 'waiting-room-sync':
        if (isHost.current) {
          setActiveJoinRequests(Array.isArray(data.requests) ? data.requests : []);
        }
        break;

      case 'admit':
      case 'accepted':
      case 'accept_user':
        sessionStorage.setItem(`meeting_admitted_${roomId}`, 'true');
        window.dispatchEvent(new CustomEvent('meeting-admitted', { detail: { roomId } }));
        break;

      case 'deny':
        window.dispatchEvent(new CustomEvent('meeting-denied', { detail: { roomId } }));
        break;

      case 'join-blocked':
        sessionStorage.removeItem(`meeting_admitted_${roomId}`);
        window.dispatchEvent(new CustomEvent('meeting-denied', { detail: { roomId } }));
        break;

      default:
        break;
    }
  }, [
    addMessage,
    createPeerConnection,
    endSessionTracking,
    roomId,
    sendSignalingMessage,
    startSessionTracking,
    syncParticipantState,
  ]);

  useEffect(() => {
    joinRoomCallbackRef.current = joinRoom;
  }, [joinRoom]);

  useEffect(() => {
    const nextIsHost = computeIsHost();
    const wasHost = isHost.current;
    isHost.current = nextIsHost;
    setIsHostState(nextIsHost);

    if (!wasHost && nextIsHost && ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'host_join' }));
    }
  }, [computeIsHost]);

  useEffect(() => {
    handleSignalingDataRef.current = handleSignalingData;
  }, [handleSignalingData]);

  useEffect(() => {
    let isMounted = true;

    const startConnection = async () => {
      let stream = null;

      // --- Step 1: Acquire media (failure is non-fatal, WebSocket still connects) ---
      if (acquireMedia) {
        try {
          const constraints = getPreferredMediaConstraints();
          const wantsAudio = constraints.audio !== false;
          const wantsVideo = constraints.video !== false;

          if (wantsAudio || wantsVideo) {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
          } else {
            stream = new MediaStream();
          }

          const audioTrack = stream.getAudioTracks()[0];
          const videoTrack = stream.getVideoTracks()[0];

          if (audioTrack) audioTrack.enabled = initialMediaState.current.audioEnabled;
          if (videoTrack) videoTrack.enabled = initialMediaState.current.videoEnabled;

          originalStream.current = stream;
          activeStreamsRef.current.push(stream);

          if (isMounted) {
            setLocalStream(stream);
            setIsAudioEnabled(audioTrack ? audioTrack.enabled : false);
            setIsVideoEnabled(videoTrack ? videoTrack.enabled : false);
          }
        } catch (mediaError) {
          console.error('Media acquisition failed, joining without camera/mic:', mediaError);
          if (isMounted) {
            setMediaError(mediaError.name === 'NotAllowedError' ? 'Permission Denied' : 'Media Device Error');
          }
          // Continue — WebSocket will still be created below
        }
      }

      // --- Step 2: Always create the WebSocket regardless of media status ---
      try {
        ws.current = new WebSocket(buildWebSocketUrl(`/ws/${roomId}/${clientId.current}`));

        ws.current.onopen = () => {
          if (ws.current?.readyState !== WebSocket.OPEN) return;

          pendingMessagesRef.current.forEach((message) => {
            ws.current?.send(JSON.stringify(message));
          });
          pendingMessagesRef.current = [];

          if (isHost.current) {
            ws.current?.send(JSON.stringify({ type: 'host_join' }));
          }

          if (autoJoin) {
            joinRoomCallbackRef.current?.();
          }
        };

        ws.current.onmessage = async (event) => {
          const message = JSON.parse(event.data);
          await handleSignalingDataRef.current?.(message, stream || originalStream.current);
        };
      } catch (wsError) {
        console.error('WebSocket connection failed:', wsError);
      }
    };

    startConnection();

    return () => {
      isMounted = false;

      if (ws.current) {
        ws.current.close();
      }

      Object.values(peerConnections.current).forEach((pc) => pc.close());
      peerConnections.current = {};

      activeStreamsRef.current.forEach((stream) => {
        stream?.getTracks().forEach((track) => track.stop());
      });
      activeStreamsRef.current = [];

      Object.keys(activeSessionIdsRef.current).forEach((participantId) => {
        endSessionTracking(participantId);
      });

      joinedRoomRef.current = false;
    };
  }, [acquireMedia, autoJoin, roomId, endSessionTracking]);

  const admitParticipant = useCallback((participantId) => {
    sendSignalingMessage({ type: 'accept_user', target: participantId });
    setActiveJoinRequests((prev) => prev.filter((request) => request.id !== participantId));
  }, [sendSignalingMessage]);

  const denyParticipant = useCallback((participantId) => {
    sendSignalingMessage({ type: 'deny', target: participantId });
    setActiveJoinRequests((prev) => prev.filter((request) => request.id !== participantId));
  }, [sendSignalingMessage]);

  const requestToJoin = useCallback((name = displayName.current) => {
    sessionStorage.setItem(`meeting_name_${roomId}`, name);
    displayName.current = name;
    sendSignalingMessage({
      type: 'ask_to_join',
      user_id: clientId.current,
      email: currentUser.current?.email || null,
      name,
      picture: currentUser.current?.picture || null,
      requested_at: new Date().toISOString(),
    });
  }, [roomId, sendSignalingMessage]);

  const toggleVideo = useCallback(() => {
    if (!localStream) {
      setIsVideoEnabled((prev) => !prev);
      return;
    }

    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsVideoEnabled(videoTrack.enabled);
      return;
    }

    setIsVideoEnabled((prev) => !prev);
  }, [localStream]);

  const toggleAudio = useCallback(() => {
    if (!localStream) {
      setIsAudioEnabled((prev) => !prev);
      return;
    }

    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsAudioEnabled(audioTrack.enabled);
      return;
    }

    setIsAudioEnabled((prev) => !prev);
  }, [localStream]);

  const stopScreenShare = useCallback((screenTrack) => {
    if (screenTrack) {
      screenTrack.stop();
    }

    const cameraTrack = originalStream.current?.getVideoTracks?.()[0];

    Object.values(peerConnections.current).forEach((pc) => {
      const videoSender = pc.getSenders().find((sender) => sender.track?.kind === 'video');
      if (videoSender && cameraTrack) {
        videoSender.replaceTrack(cameraTrack);
      }
    });

    setLocalStream(originalStream.current);
    setIsSharingScreen(false);

    setParticipantsMetadata((prev) => ({
      ...prev,
      [clientId.current]: {
        ...prev[clientId.current],
        isSharingScreen: false,
      },
    }));

    sendSignalingMessage({
      type: 'participant-update',
      name: displayName.current,
      role: isHost.current ? 'host' : 'participant',
      isHandRaised,
      isSharingScreen: false,
    });
  }, [isHandRaised, sendSignalingMessage]);

  const toggleScreenShare = useCallback(async () => {
    try {
      if (!isSharingScreen) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        activeStreamsRef.current.push(screenStream);

        const screenTrack = screenStream.getVideoTracks()[0];

        Object.values(peerConnections.current).forEach((pc) => {
          const videoSender = pc.getSenders().find((sender) => sender.track?.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(screenTrack);
          }
        });

        screenTrack.onended = () => {
          stopScreenShare(screenTrack);
        };

        setLocalStream(screenStream);
        setIsSharingScreen(true);

        setParticipantsMetadata((prev) => ({
          ...prev,
          [clientId.current]: {
            ...prev[clientId.current],
            isSharingScreen: true,
          },
        }));

        sendSignalingMessage({
          type: 'participant-update',
          name: displayName.current,
          role: isHost.current ? 'host' : 'participant',
          isHandRaised,
          isSharingScreen: true,
        });
      } else {
        const screenTrack = localStream?.getVideoTracks?.()[0];
        stopScreenShare(screenTrack);
      }
    } catch (error) {
      console.error('Error sharing screen:', error);
    }
  }, [isHandRaised, isSharingScreen, localStream, sendSignalingMessage, stopScreenShare]);

  const toggleRaiseHand = useCallback(() => {
    const nextState = !isHandRaised;
    setIsHandRaised(nextState);

    setParticipantsMetadata((prev) => ({
      ...prev,
      [clientId.current]: {
        ...prev[clientId.current],
        isHandRaised: nextState,
      },
    }));

    sendSignalingMessage({
      type: nextState ? 'raise-hand' : 'lower-hand',
      name: displayName.current,
    });

    sendSignalingMessage({
      type: 'participant-update',
      name: displayName.current,
      role: isHost.current ? 'host' : 'participant',
      isHandRaised: nextState,
      isSharingScreen,
    });
  }, [isHandRaised, isSharingScreen, sendSignalingMessage]);

  const sendChatMessage = useCallback((text) => {
    sendSignalingMessage({
      type: 'chat',
      text,
      sent_at: new Date().toISOString(),
    });
    addMessage({ sender: 'Me', text });
  }, [addMessage, sendSignalingMessage]);

  const getPeerConnection = useCallback((peerId) => peerConnections.current[peerId] ?? null, []);

  return {
    localStream,
    remoteStreams,
    messages,
    participantsMetadata,
    isSharingScreen,
    isHandRaised,
    toggleVideo,
    toggleAudio,
    toggleScreenShare,
    toggleRaiseHand,
    sendChatMessage,
    admitParticipant,
    denyParticipant,
    requestToJoin,
    activeJoinRequests,
    isHost: isHostState,
    mediaError,
    joinRoom,
    displayName: displayName.current,
    isAudioEnabled,
    isVideoEnabled,
    localClientId: clientId.current,
    getPeerConnection,
    sendSignalingMessage,
  };
}
