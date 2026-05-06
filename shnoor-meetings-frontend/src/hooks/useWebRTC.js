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
  const storageKey = `meeting_name_${roomId}`;
  const existingName = sessionStorage.getItem(storageKey);

  if (existingName) {
    return existingName;
  }

  const currentUser = getCurrentUser();
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
  const [cameraStream, setCameraStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [messages, setMessages] = useState([]);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [participantsMetadata, setParticipantsMetadata] = useState({});
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [activeJoinRequests, setActiveJoinRequests] = useState([]);
  const [isWSConnected, setIsWSConnected] = useState(false);
  const initialMediaState = useRef(getPreJoinMediaState(roomId));
  const [isAudioEnabled, setIsAudioEnabled] = useState(initialMediaState.current.audioEnabled);
  const [isVideoEnabled, setIsVideoEnabled] = useState(initialMediaState.current.videoEnabled);
  const normalizedCurrentEmail = (getCurrentUser()?.email || '').trim().toLowerCase();
  const storedHostEmail = (localStorage.getItem(`meeting_host_${roomId}`) || '').trim().toLowerCase();
  const hasStoredHostAccess = Boolean(
    normalizedCurrentEmail &&
    storedHostEmail &&
    storedHostEmail === normalizedCurrentEmail
  ) || Boolean(
    storedHostEmail &&
    storedHostEmail === `id:${getCurrentUser()?.meetingUserId}`
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
  // Stores the video RTCRtpTransceiver for each peer so we can reliably replaceTrack
  const videoTransceiversRef = useRef({});

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
      admitted: !isHost.current && sessionStorage.getItem(`meeting_admitted_${roomId}`) === 'true',
      isAudioEnabled,
      isVideoEnabled,
      joined_at: new Date().toISOString(),
    });

    // If host: also send host_join so backend marks this in-meeting WS as role=host.
    // This ensures ask_to_join messages from participants are routed here correctly.
    if (isHost.current) {
      sendSignalingMessage({ type: 'host_join' });
    }
  }, [autoJoin, roomId, sendSignalingMessage, startSessionTracking]);

  const createPeerConnection = useCallback((peerId, stream) => {
    if (!peerId) return null;
    if (peerConnections.current[peerId]) return peerConnections.current[peerId];

    const pc = new RTCPeerConnection(ICE_SERVERS);

    // Add audio
    const audioTrack = stream?.getAudioTracks()[0] || null;
    if (audioTrack) {
      pc.addTrack(audioTrack, stream);
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    // ALWAYS add a sendrecv video transceiver and store its reference.
    // This ensures ontrack fires correctly on BOTH sides, and replaceTrack
    // always has a valid sender regardless of camera state.
    const videoTrack = stream?.getVideoTracks()[0] || null;
    const videoTransceiver = pc.addTransceiver(
      videoTrack || 'video',
      { direction: 'sendrecv', streams: stream ? [stream] : [] }
    );
    videoTransceiversRef.current[peerId] = videoTransceiver;

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
      setRemoteStreams((prev) => {
        let incomingStream = event.streams[0];
        if (!incomingStream) {
          incomingStream = prev[peerId] || new MediaStream();
          incomingStream.addTrack(event.track);
        }
        return { ...prev, [peerId]: incomingStream };
      });
    };

    peerConnections.current[peerId] = pc;
    return pc;
  }, [sendSignalingMessage]);


  const handleSignalingData = useCallback(async (data, stream) => {
    const { type, sender, target } = data;
    const peerId = sender || data.client_id;

    // ── Admission control messages: handle BEFORE any early-return guards ──────
    // These are directed at this specific client and must never be filtered out.
    if (type === 'accepted' || type === 'admit' || type === 'accept_user') {
      sessionStorage.setItem(`meeting_admitted_${roomId}`, 'true');
      window.dispatchEvent(new CustomEvent('meeting-admitted', { detail: { roomId } }));
      return;
    }
    if (type === 'deny') {
      window.dispatchEvent(new CustomEvent('meeting-denied', { detail: { roomId } }));
      return;
    }
    if (type === 'join-blocked') {
      sessionStorage.removeItem(`meeting_admitted_${roomId}`);
      window.dispatchEvent(new CustomEvent('meeting-denied', { detail: { roomId } }));
      return;
    }

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
        // NOTE: video transceiver is already added and stored in createPeerConnection.

        setParticipantsMetadata((prev) => ({
          ...prev,
          [peerId]: {
            ...prev[peerId],
            name: data.name || prev[peerId]?.name || 'Participant',
            picture: data.picture || prev[peerId]?.picture || null,
            role: data.role || prev[peerId]?.role || 'participant',
            isHandRaised: prev[peerId]?.isHandRaised || false,
            isSharingScreen: prev[peerId]?.isSharingScreen || false,
            isVideoEnabled: data.isVideoEnabled ?? prev[peerId]?.isVideoEnabled ?? true,
            isAudioEnabled: data.isAudioEnabled ?? prev[peerId]?.isAudioEnabled ?? true,
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
        if (!pcOffer) return;

        await pcOffer.setRemoteDescription(new RTCSessionDescription(data.offer));

        // After setRemoteDescription, Chrome has assigned mids to transceivers.
        // The transceiver WITH a mid is the one actually matched to the host's
        // video m-line — this is the correct sender for replaceTrack.
        // Without a mid: our pre-added transceiver (may not be connected to host).
        // With a mid: the matched transceiver (ALWAYS the correct one to use).
        const allVideoTCs = pcOffer.getTransceivers().filter(t =>
          t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video'
        );

        // Prefer the transceiver with a mid assigned (matched to remote offer)
        const matchedTC = allVideoTCs.find(t => t.mid !== null) || allVideoTCs[0];

        if (matchedTC) {
          // Force sendrecv so the participant can send screen share to host
          if (matchedTC.direction !== 'sendrecv') {
            matchedTC.direction = 'sendrecv';
          }
          // Always overwrite with the correctly matched transceiver
          videoTransceiversRef.current[peerId] = matchedTC;
        }

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

      case 'room-state':
        if (Array.isArray(data.participants)) {
          setParticipantsMetadata((prev) => {
            const nextMetadata = { ...prev };
            data.participants.forEach((p) => {
              if (p.id !== clientId.current) {
                nextMetadata[p.id] = {
                  ...nextMetadata[p.id],
                  ...p,
                };
              }
            });
            return nextMetadata;
          });
        }
        break;

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
            isVideoEnabled: typeof data.isVideoEnabled === 'boolean' ? data.isVideoEnabled : prev[peerId]?.isVideoEnabled,
            isAudioEnabled: typeof data.isAudioEnabled === 'boolean' ? data.isAudioEnabled : prev[peerId]?.isAudioEnabled,
          },
        }));
        break;

      case 'join-request':
      case 'join_request':
      case 'incoming-join-request':
        console.log('[WebRTC] Join request received:', data);
        if (isHost.current) {
          const requester = data.user || data;
          const reqId = requester.id || peerId;

          setActiveJoinRequests((prev) => {
            if (prev.find((request) => request.id === reqId)) {
              return prev;
            }

            console.log('[WebRTC] Adding join request to state:', reqId);
            return [
              ...prev,
              {
                id: reqId,
                name: requester.name || 'Participant',
                picture: requester.picture || null,
              },
            ];
          });
        } else {
          console.warn('[WebRTC] Received join request but I am not marked as host. isHost.current:', isHost.current);
        }
        break;

      case 'waiting-room-sync':
        console.log('[WebRTC] Waiting room sync received:', data.requests);
        if (isHost.current) {
          setActiveJoinRequests(Array.isArray(data.requests) ? data.requests : []);
        }
        break;

      // admission cases are handled above before the early-return guards
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

    // If I am a host, ensure the backend knows it.
    // This is critical for receiving join requests while in the Lobby (autoJoin=false).
    if (nextIsHost && ws.current?.readyState === WebSocket.OPEN) {
      sendSignalingMessage({ type: 'host_join' });
      syncParticipantState();
    }

    // Sync local metadata for local tile display
    setParticipantsMetadata(prev => ({
      ...prev,
      [clientId.current]: {
        name: displayName.current,
        role: nextIsHost ? 'host' : 'participant',
        isAudioEnabled,
        isVideoEnabled,
        isHandRaised,
        isSharingScreen
      }
    }));
  }, [computeIsHost, isAudioEnabled, isVideoEnabled, isHandRaised, isSharingScreen, syncParticipantState]);

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
            setCameraStream(stream);
            setIsAudioEnabled(audioTrack ? audioTrack.enabled : false);
            setIsVideoEnabled(videoTrack ? videoTrack.enabled : false);
          }
        } catch (mediaError) {
          console.error('Media acquisition failed, joining without camera/mic:', mediaError);
          if (isMounted) {
            setIsAudioEnabled(false);
            setIsVideoEnabled(false);
            setMediaError(mediaError.name === 'NotAllowedError' ? 'Permission Denied' : 'Media Device Error');
          }
          // Continue — WebSocket will still be created below
        }
      }

      // --- Step 2: Always create the WebSocket regardless of media status ---
      try {
        const role = isHost.current ? 'host' : 'participant';
        const wsUrl = buildWebSocketUrl(`/ws/${roomId}/${role}?client_id=${clientId.current}`);
        console.log(`[WebSocket] Connecting to: ${wsUrl}`);
        ws.current = new WebSocket(wsUrl);

        ws.current.onopen = () => {
          console.log(`[WebSocket] Connected: meetingId=${roomId}, role=${role}, clientId=${clientId.current}`);
          setIsWSConnected(true);
          if (ws.current?.readyState !== WebSocket.OPEN) return;

          pendingMessagesRef.current.forEach((message) => {
            ws.current?.send(JSON.stringify(message));
          });
          pendingMessagesRef.current = [];

          if (autoJoin) {
            joinRoomCallbackRef.current?.();
          }
        };

        ws.current.onmessage = async (event) => {
          const message = JSON.parse(event.data);
          console.log(`[WebSocket] Received message:`, message.type);
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
        setIsWSConnected(false);
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
    
    console.log('[WebRTC] Requesting to join meeting:', roomId, 'as', name);
    // User requested structure:
    // { "type": "join-request", "meetingId": "...", "user": { "name": "...", "email": "..." } }
    sendSignalingMessage({
      type: 'join-request',
      meetingId: roomId,
      user: {
        id: clientId.current,
        name,
        email: currentUser.current?.email || null
      }
    });
  }, [roomId, sendSignalingMessage]);

  const toggleVideo = useCallback(async () => {
    // Check for a real camera track (not canvas dummy) in originalStream
    const realVideoTrack = originalStream.current?.getVideoTracks()
      .find(t => t.readyState === 'live' && !t.label?.toLowerCase().includes('canvas'));

    if (realVideoTrack) {
      // Toggle it on/off
      realVideoTrack.enabled = !realVideoTrack.enabled;
      const newState = realVideoTrack.enabled;
      setIsVideoEnabled(newState);
      setParticipantsMetadata((prev) => ({
        ...prev,
        [clientId.current]: { ...prev[clientId.current] || {}, isVideoEnabled: newState },
      }));
      syncParticipantState({ isVideoEnabled: newState });
    } else {
      // No real camera yet — acquire one and replace dummy in all PCs
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const newTrack = camStream.getVideoTracks()[0];
        if (!newTrack) return;

        // Use stored transceiver references for reliable replacement
        await Promise.all(
          Object.entries(videoTransceiversRef.current).map(([, transceiver]) =>
            transceiver.sender.replaceTrack(newTrack).catch(e =>
              console.error('[toggleVideo] replaceTrack failed:', e)
            )
          )
        );

        // Update originalStream with real camera
        if (originalStream.current) {
          originalStream.current.getVideoTracks().forEach(t => { t.stop(); originalStream.current.removeTrack(t); });
          originalStream.current.addTrack(newTrack);
        }

        // Create a new MediaStream so React detects the change
        const next = new MediaStream();
        localStream?.getAudioTracks().forEach(t => next.addTrack(t));
        next.addTrack(newTrack);
        
        setLocalStream(next);
        setCameraStream(next);

        setIsVideoEnabled(true);
        setParticipantsMetadata((prev) => ({
          ...prev,
          [clientId.current]: { ...prev[clientId.current] || {}, isVideoEnabled: true },
        }));
        syncParticipantState({ isVideoEnabled: true });
      } catch (e) {
        console.error('[toggleVideo] Failed to acquire camera:', e);
      }
    }
  }, [syncParticipantState]);


  const toggleAudio = useCallback(async () => {
    let newState;
    if (!localStream) return;

    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      newState = audioTrack.enabled;
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const newTrack = stream.getAudioTracks()[0];
        if (newTrack) {
          localStream.addTrack(newTrack);
          originalStream.current?.addTrack(newTrack);
          Object.values(peerConnections.current).forEach((pc) => {
            const audioTransceiver = pc.getTransceivers().find(t => t.receiver.track.kind === 'audio');
            if (audioTransceiver && audioTransceiver.sender) {
              audioTransceiver.sender.replaceTrack(newTrack).catch(e => console.error("Replace audio track failed:", e));
            }
          });
          newState = true;
        }
      } catch (e) {
        console.error("Failed to acquire audio track:", e);
        return;
      }
    }

    setIsAudioEnabled(newState);
    setParticipantsMetadata((prev) => ({
      ...prev,
      [clientId.current]: {
        ...prev[clientId.current] || {},
        isAudioEnabled: newState,
      },
    }));
    syncParticipantState({ isAudioEnabled: newState });
  }, [localStream, syncParticipantState]);

  const stopScreenShare = useCallback((screenTrack) => {
    if (screenTrack) { screenTrack.stop(); screenTrack.onended = null; }

    const cameraTrack = originalStream.current?.getVideoTracks()
      .find(t => t.readyState === 'live' && !t.label?.toLowerCase().includes('canvas')) || null;

    // Use stored transceiver references
    Object.values(videoTransceiversRef.current).forEach((transceiver) => {
      transceiver.sender.replaceTrack(cameraTrack).catch(err =>
        console.warn('[ScreenShare] Failed to restore camera track:', err)
      );
    });

    setLocalStream(originalStream.current);
    setCameraStream(originalStream.current);
    setIsSharingScreen(false);
    setParticipantsMetadata((prev) => ({
      ...prev,
      [clientId.current]: { ...prev[clientId.current], isSharingScreen: false },
    }));
    syncParticipantState({ isSharingScreen: false });
  }, [syncParticipantState]);

  const toggleScreenShare = useCallback(async () => {
    try {
      if (!isSharingScreen) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' },
          audio: false,
        });

        activeStreamsRef.current.push(screenStream);
        const screenTrack = screenStream.getVideoTracks()[0];

        // Triple-fallback approach to guarantee we find the video sender
        await Promise.all(
          Object.entries(peerConnections.current).map(async ([peerId, pc]) => {
            // Strategy 1: Use stored transceiver reference
            const storedTransceiver = videoTransceiversRef.current[peerId];
            if (storedTransceiver) {
              try {
                await storedTransceiver.sender.replaceTrack(screenTrack);
                return;
              } catch (e) {
                console.warn('[ScreenShare] stored transceiver replaceTrack failed, trying fallback:', e);
              }
            }

            // Strategy 2: Find video sender via getSenders (track.kind === 'video')
            const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
            if (videoSender) {
              try {
                await videoSender.replaceTrack(screenTrack);
                return;
              } catch (e) {
                console.warn('[ScreenShare] getSenders fallback failed:', e);
              }
            }

            // Strategy 3: Walk all transceivers and pick the first video one
            for (const tc of pc.getTransceivers()) {
              if (tc.sender && (tc.sender.track?.kind === 'video' || tc.receiver?.track?.kind === 'video')) {
                try {
                  await tc.sender.replaceTrack(screenTrack);
                  // Store this transceiver for future use
                  videoTransceiversRef.current[peerId] = tc;
                  return;
                } catch (e) {
                  console.warn('[ScreenShare] transceiver walk failed:', e);
                }
              }
            }

            console.error('[ScreenShare] Could not find any video sender for peer:', peerId);
          })
        );

        screenTrack.onended = () => stopScreenShare(screenTrack);

        const newLocalStream = new MediaStream();
        originalStream.current?.getAudioTracks().forEach(t => newLocalStream.addTrack(t));
        newLocalStream.addTrack(screenTrack);

        setLocalStream(newLocalStream);
        setIsSharingScreen(true);
        setParticipantsMetadata((prev) => ({
          ...prev,
          [clientId.current]: { ...prev[clientId.current] || {}, isSharingScreen: true },
        }));
        syncParticipantState({ isSharingScreen: true });
      } else {
        const screenTrack = localStream?.getVideoTracks?.()?.[0];
        stopScreenShare(screenTrack);
      }
    } catch (error) {
      console.error('[ScreenShare] Error:', error);
      setIsSharingScreen(false);
    }
  }, [isSharingScreen, localStream, stopScreenShare, syncParticipantState]);


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
    cameraStream,
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
    cameraStream,
    isWSConnected,
  };
}
