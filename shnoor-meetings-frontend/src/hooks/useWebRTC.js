import { useState, useEffect, useRef, useCallback } from 'react';
import {
  closeCallHistoryEntry,
  getPreJoinMediaState,
  getPreferredMediaConstraints,
  upsertCallHistoryEntry,
} from '../utils/meetingUtils';
import { buildApiUrl, buildWebSocketUrl } from '../utils/api';
import { getCurrentUser, getUserPicture } from '../utils/currentUser';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function getStableClientId(roomId, role = 'participant') {
  const normalizedRole = role === 'host' ? 'host' : 'participant';
  const storageKey = `meeting_client_${roomId}_${normalizedRole}`;
  const existingId = sessionStorage.getItem(storageKey);
  const currentUser = getCurrentUser();

  if (existingId) {
    return existingId;
  }

  const userPrefix = currentUser?.meetingUserId ? currentUser.meetingUserId.slice(0, 8) : 'guest';
  const nextId = `${userPrefix}-${crypto.randomUUID()}`;
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
  const generatedName = currentUser?.name || (isHost ? 'Host' : `Guest ${getStableClientId(roomId, 'participant').slice(-4).toUpperCase()}`);
  sessionStorage.setItem(storageKey, generatedName);
  return generatedName;
}

function getEmailFromUrl() {
  if (typeof window === 'undefined') {
    return '';
  }

  return new URLSearchParams(window.location.search).get('email') || '';
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
  const [sharedHostAccess, setSharedHostAccess] = useState(null);
  const initialMediaState = useRef(getPreJoinMediaState(roomId));
  const [isAudioEnabled, setIsAudioEnabled] = useState(initialMediaState.current.audioEnabled);
  const [isVideoEnabled, setIsVideoEnabled] = useState(initialMediaState.current.videoEnabled);
  const normalizedCurrentEmail = (getEmailFromUrl() || getCurrentUser()?.email || '').trim().toLowerCase();
  const storedHostEmail = (localStorage.getItem(`meeting_host_${roomId}`) || '').trim().toLowerCase();
  const hasStoredHostAccess = Boolean(
    normalizedCurrentEmail &&
    storedHostEmail &&
    storedHostEmail === normalizedCurrentEmail
  ) || Boolean(
    storedHostEmail &&
    storedHostEmail === `id:${getCurrentUser()?.meetingUserId}`
  );

  const computeIsHost = useCallback(() => {
    if (initialRole === 'participant') {
      return false;
    }

    const roleInSession = sessionStorage.getItem(`meeting_role_${roomId}`);
    const hostInLocal = (localStorage.getItem(`meeting_host_${roomId}`) || '').trim().toLowerCase();
    const currentUser = getCurrentUser();
    const myEmail = (getEmailFromUrl() || sessionStorage.getItem(`meeting_email_${roomId}`) || currentUser?.email || '').trim().toLowerCase();
    const myId = currentUser?.meetingUserId;

    return (
      initialRole === 'host' ||
      roleInSession === 'host' ||
      (hostInLocal && myEmail && hostInLocal === myEmail) ||
      (hostInLocal && myId && hostInLocal === `id:${myId}`) ||
      hasStoredHostAccess
    );
  }, [hasStoredHostAccess, initialRole, roomId]);

  const [isHostState, setIsHostState] = useState(() => computeIsHost());
  const isHost = useRef(isHostState);
  const clientId = useRef(getStableClientId(roomId, isHostState ? 'host' : 'participant'));
  const displayName = useRef(getDisplayName(roomId, isHostState));
  const currentUser = useRef(getCurrentUser());
  const ws = useRef(null);
  const peerConnections = useRef({});
  const originalStream = useRef(null);
  const currentOutgoingStreamRef = useRef(null);
  const activeStreamsRef = useRef([]);
  const joinedRoomRef = useRef(false);
  const activeSessionIdsRef = useRef({});
  const joinRoomCallbackRef = useRef(null);
  const handleSignalingDataRef = useRef(null);
  const pendingMessagesRef = useRef([]);
  const answerRenegotiatedPeersRef = useRef(new Set());
  // Stores the video RTCRtpTransceiver for each peer so we can reliably replaceTrack
  const videoTransceiversRef = useRef({});
  const audioTransceiversRef = useRef({});

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
      picture: getUserPicture(currentUser.current) || null,
      role: isHost.current ? 'host' : (sharedHostAccess ? 'host' : 'participant'),
      hostAccess: Boolean(sharedHostAccess),
      hostAccessRestrictions: sharedHostAccess?.restrictions || null,
      isHandRaised,
      isSharingScreen,
      isAudioEnabled,
      isVideoEnabled,
      ...extraState,
    });
  }, [isAudioEnabled, isHandRaised, isSharingScreen, isVideoEnabled, sendSignalingMessage, sharedHostAccess]);

  const publishLocalStream = useCallback((nextStream, { camera = false } = {}) => {
    currentOutgoingStreamRef.current = nextStream || null;
    setLocalStream(nextStream || null);
    if (camera) {
      setCameraStream(nextStream || null);
    }
  }, []);

  const transceiverMatchesKind = useCallback((transceiver, kind) => (
    transceiver?.sender?.track?.kind === kind ||
    transceiver?.receiver?.track?.kind === kind ||
    transceiver?.receiver?.track?.kind === kind
  ), []);

  const replaceSenderTrack = useCallback(async (peerId, kind, track) => {
    const pc = peerConnections.current[peerId];
    if (!pc) return;

    const transceiverMap = kind === 'video' ? videoTransceiversRef.current : audioTransceiversRef.current;
    let transceiver = transceiverMap[peerId];

    if (!transceiverMatchesKind(transceiver, kind)) {
      transceiver = pc.getTransceivers().find((tc) =>
        tc.sender && (tc.sender.track?.kind === kind || tc.receiver?.track?.kind === kind)
      );
      if (transceiver) {
        transceiverMap[peerId] = transceiver;
      }
    }

    const sender = transceiver?.sender || pc.getSenders().find((s) => s.track?.kind === kind);
    if (sender) {
      await sender.replaceTrack(track);
      return;
    }

    if (track) {
      const nextTransceiver = pc.addTransceiver(track, {
        direction: 'sendrecv',
        streams: currentOutgoingStreamRef.current ? [currentOutgoingStreamRef.current] : [],
      });
      transceiverMap[peerId] = nextTransceiver;
    }
  }, [transceiverMatchesKind]);

  const attachLocalTracksToPeer = useCallback(async (peerId, stream) => {
    const audioTrack = stream?.getAudioTracks?.()[0] || null;
    const videoTrack = stream?.getVideoTracks?.()[0] || null;

    await Promise.all([
      replaceSenderTrack(peerId, 'audio', audioTrack),
      replaceSenderTrack(peerId, 'video', videoTrack),
    ]);
  }, [replaceSenderTrack]);

  const replaceTrackForAllPeers = useCallback(async (kind, track) => {
    await Promise.all(
      Object.keys(peerConnections.current).map((peerId) =>
        replaceSenderTrack(peerId, kind, track).catch((error) =>
          console.warn(`[WebRTC] Failed to replace ${kind} track for ${peerId}:`, error)
        )
      )
    );
  }, [replaceSenderTrack]);

  const renegotiatePeer = useCallback(async (peerId) => {
    const pc = peerConnections.current[peerId];
    if (!pc || pc.signalingState !== 'stable') return;

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignalingMessage({ type: 'offer', target: peerId, offer });
    } catch (error) {
      console.warn(`[WebRTC] Failed to renegotiate with ${peerId}:`, error);
    }
  }, [sendSignalingMessage]);

  const renegotiateAllPeers = useCallback(async () => {
    await Promise.all(Object.keys(peerConnections.current).map((peerId) => renegotiatePeer(peerId)));
  }, [renegotiatePeer]);

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
        picture: getUserPicture(currentUser.current) || null,
        role: isHost.current ? 'host' : (sharedHostAccess ? 'host' : 'participant'),
        hostAccess: Boolean(sharedHostAccess),
        hostAccessRestrictions: sharedHostAccess?.restrictions || null,
        isHandRaised: false,
        isSharingScreen: false,
        isAudioEnabled,
        isVideoEnabled,
      },
    }));

    startSessionTracking(clientId.current, displayName.current, isHost.current ? 'host' : (sharedHostAccess ? 'host' : 'participant'));

    const user = currentUser.current;
    const payload = {
      type: 'join-room',
      user_id: user?.meetingUserId || clientId.current,
      firebase_uid: user?.firebaseUid || null,
      name: sessionStorage.getItem(`meeting_name_${roomId}`) || user?.name || 'Participant',
      email: getEmailFromUrl() || user?.email || sessionStorage.getItem(`meeting_email_${roomId}`) || null,
      picture: getUserPicture(user) || null,
      role: isHost.current ? 'host' : (sharedHostAccess ? 'host' : 'participant'),
      hostAccess: Boolean(sharedHostAccess),
      hostAccessRestrictions: sharedHostAccess?.restrictions || null,
      admitted: !isHost.current && sessionStorage.getItem(`meeting_admitted_${roomId}`) === 'true',
      isAudioEnabled,
      isVideoEnabled,
      joined_at: new Date().toISOString(),
    };

    sendSignalingMessage(payload);

    // If host: also send host_join so backend marks this in-meeting WS as role=host.
    // This ensures ask_to_join messages from participants are routed here correctly.
    if (isHost.current) {
      sendSignalingMessage({ type: 'host_join' });
    }
  }, [autoJoin, roomId, sendSignalingMessage, sharedHostAccess, startSessionTracking]);

  const createPeerConnection = useCallback((peerId, stream, { addInitialTransceivers = true } = {}) => {
    if (!peerId) return null;
    if (peerConnections.current[peerId]) return peerConnections.current[peerId];

    const pc = new RTCPeerConnection(ICE_SERVERS);

    if (addInitialTransceivers) {
      const audioTrack = stream?.getAudioTracks()[0] || null;
      audioTransceiversRef.current[peerId] = pc.addTransceiver(
        audioTrack || 'audio',
        { direction: 'sendrecv', streams: stream ? [stream] : [] }
      );

      const videoTrack = stream?.getVideoTracks()[0] || null;
      const videoTransceiver = pc.addTransceiver(
        videoTrack || 'video',
        { direction: 'sendrecv', streams: stream ? [stream] : [] }
      );
      videoTransceiversRef.current[peerId] = videoTransceiver;
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
      const syncTrackState = () => {
        setParticipantsMetadata((prev) => ({
          ...prev,
          [peerId]: {
            ...prev[peerId],
            ...(event.track.kind === 'audio'
              ? { isAudioEnabled: event.track.readyState === 'live' && event.track.enabled && !event.track.muted }
              : {}),
            ...(event.track.kind === 'video'
              ? { isVideoEnabled: event.track.readyState === 'live' && event.track.enabled && !event.track.muted }
              : {}),
          },
        }));
      };

      event.track.addEventListener('mute', syncTrackState);
      event.track.addEventListener('unmute', syncTrackState);
      event.track.addEventListener('ended', syncTrackState);
      syncTrackState();

      setParticipantsMetadata((prev) => ({
        ...prev,
        [peerId]: {
          ...prev[peerId],
          ...(event.track.kind === 'audio' && typeof prev[peerId]?.isAudioEnabled !== 'boolean'
            ? { isAudioEnabled: true }
            : {}),
          ...(event.track.kind === 'video' && typeof prev[peerId]?.isVideoEnabled !== 'boolean'
            ? { isVideoEnabled: true }
            : {}),
        },
      }));

      setRemoteStreams((prev) => {
        const existingStream = prev[peerId] || event.streams[0] || new MediaStream();
        const tracks = existingStream.getTracks();

        if (!tracks.some((track) => track.id === event.track.id)) {
          tracks.push(event.track);
        }

        return { ...prev, [peerId]: new MediaStream(tracks) };
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
    if (type === 'removed-from-meeting') {
      sessionStorage.removeItem(`meeting_admitted_${roomId}`);
      window.dispatchEvent(new CustomEvent('meeting-removed', { detail: { roomId } }));
      return;
    }
    if (type === 'host-access-granted') {
      const restrictions = data.restrictions || {};
      setSharedHostAccess({ grantedBy: sender, restrictions });
      sessionStorage.setItem(`meeting_shared_host_access_${roomId}`, JSON.stringify(restrictions));
      setParticipantsMetadata((prev) => ({
        ...prev,
        [clientId.current]: {
          ...prev[clientId.current],
          name: displayName.current,
          picture: getUserPicture(currentUser.current) || null,
          role: 'host',
          hostAccess: true,
          hostAccessRestrictions: restrictions,
        },
      }));
      window.dispatchEvent(new CustomEvent('meeting-host-access-granted', { detail: { roomId, restrictions } }));
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
        const stream_ = currentOutgoingStreamRef.current || stream || originalStream.current;
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
            hostAccess: typeof data.hostAccess === 'boolean' ? data.hostAccess : prev[peerId]?.hostAccess,
            hostAccessRestrictions: data.hostAccessRestrictions || prev[peerId]?.hostAccessRestrictions,
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
        const stream_ = currentOutgoingStreamRef.current || stream || originalStream.current;
        const pcOffer = createPeerConnection(peerId, stream_, { addInitialTransceivers: false });
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

        const matchedAudioTC = pcOffer.getTransceivers().find(t =>
          t.receiver?.track?.kind === 'audio' || t.sender?.track?.kind === 'audio'
        );
        if (matchedAudioTC) {
          if (matchedAudioTC.direction !== 'sendrecv') {
            matchedAudioTC.direction = 'sendrecv';
          }
          audioTransceiversRef.current[peerId] = matchedAudioTC;
        }

        await attachLocalTracksToPeer(peerId, stream_);

        const answer = await pcOffer.createAnswer();
        await pcOffer.setLocalDescription(answer);
        sendSignalingMessage({ type: 'answer', target: peerId, answer });

        if (!isHost.current && !answerRenegotiatedPeersRef.current.has(peerId)) {
          answerRenegotiatedPeersRef.current.add(peerId);
          window.setTimeout(() => {
            attachLocalTracksToPeer(peerId, currentOutgoingStreamRef.current || originalStream.current)
              .then(() => renegotiatePeer(peerId))
              .catch((error) => console.warn(`[WebRTC] Failed to renegotiate local tracks for ${peerId}:`, error));
          }, 300);
        }
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
            hostAccess: typeof data.hostAccess === 'boolean' ? data.hostAccess : prev[peerId]?.hostAccess,
            hostAccessRestrictions: data.hostAccessRestrictions || prev[peerId]?.hostAccessRestrictions,
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
        // Fallback: If we get a join request, we should probably check if we ARE the host 
        // even if the ref is slightly behind, or just trust the backend routed it to us for a reason.
        if (isHost.current || computeIsHost() || sharedHostAccess) {
          const requester = data.user || data;
          const reqId = requester.id || peerId;

          setActiveJoinRequests((prev) => {
            if (prev.find((request) => request.id === reqId)) {
              return prev;
            }

            console.log('[WebRTC] Adding join request to state:', reqId, requester.name);
            return [
              ...prev,
              {
                id: reqId,
                name: requester.name || 'Participant',
                picture: getUserPicture(requester) || requester.picture || null,
              },
            ];
          });
        } else {
          console.warn('[WebRTC] Received join request but I am not marked as host. isHost.current:', isHost.current);
        }
        break;

      case 'waiting-room-sync':
        console.log('[WebRTC] Waiting room sync received:', data.requests);
        if (isHost.current || computeIsHost() || sharedHostAccess) {
          setActiveJoinRequests(Array.isArray(data.requests) ? data.requests : []);
        }
        break;

      // admission cases are handled above before the early-return guards
      default:
        break;
    }
  }, [
    addMessage,
    attachLocalTracksToPeer,
    createPeerConnection,
    endSessionTracking,
    roomId,
    renegotiatePeer,
    sendSignalingMessage,
    sharedHostAccess,
    startSessionTracking,
    syncParticipantState,
  ]);

  useEffect(() => {
    joinRoomCallbackRef.current = joinRoom;
  }, [joinRoom]);

  useEffect(() => {
    const nextIsHost = computeIsHost();
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
          currentOutgoingStreamRef.current = stream;
          activeStreamsRef.current.push(stream);

          if (isMounted) {
            publishLocalStream(stream, { camera: true });
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
        const email = getEmailFromUrl() || currentUser.current?.email || sessionStorage.getItem(`meeting_email_${roomId}`) || '';
        const wsUrl = buildWebSocketUrl(`/ws/${roomId}/${role}?client_id=${clientId.current}${email ? `&email=${encodeURIComponent(email)}` : ''}`);
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
      currentOutgoingStreamRef.current = null;
      originalStream.current = null;

      Object.keys(activeSessionIdsRef.current).forEach((participantId) => {
        endSessionTracking(participantId);
      });

      joinedRoomRef.current = false;
    };
  }, [acquireMedia, autoJoin, roomId, endSessionTracking, publishLocalStream]);

  const admitParticipant = useCallback(async (participantId) => {
    sendSignalingMessage({ type: 'accept_user', target: participantId });
    setActiveJoinRequests((prev) => prev.filter((request) => request.id !== participantId));
    try {
      await fetch(buildApiUrl(`/api/meetings/${roomId}/waiting-room/${participantId}/admit`), {
        method: 'POST',
      });
    } catch (error) {
      console.warn('[WebRTC] Admit fallback failed:', error);
    }
  }, [roomId, sendSignalingMessage]);

  const denyParticipant = useCallback(async (participantId) => {
    sendSignalingMessage({ type: 'deny', target: participantId });
    setActiveJoinRequests((prev) => prev.filter((request) => request.id !== participantId));
    try {
      await fetch(buildApiUrl(`/api/meetings/${roomId}/waiting-room/${participantId}/deny`), {
        method: 'POST',
      });
    } catch (error) {
      console.warn('[WebRTC] Deny fallback failed:', error);
    }
  }, [roomId, sendSignalingMessage]);

  const removeParticipant = useCallback((participantId) => {
    if (!participantId || participantId === clientId.current || (!isHost.current && !computeIsHost() && !sharedHostAccess)) {
      return;
    }

    sendSignalingMessage({ type: 'remove-participant', target: participantId });

    if (peerConnections.current[participantId]) {
      peerConnections.current[participantId].close();
      delete peerConnections.current[participantId];
    }

    setRemoteStreams((prev) => {
      const nextStreams = { ...prev };
      delete nextStreams[participantId];
      return nextStreams;
    });

    setParticipantsMetadata((prev) => {
      const nextMetadata = { ...prev };
      delete nextMetadata[participantId];
      return nextMetadata;
    });

    endSessionTracking(participantId);
  }, [computeIsHost, endSessionTracking, sendSignalingMessage, sharedHostAccess]);

  const grantHostAccess = useCallback((participantId, restrictions = {}) => {
    if (!participantId || participantId === clientId.current || (!isHost.current && !computeIsHost())) {
      return;
    }

    sendSignalingMessage({
      type: 'share-host-access',
      target: participantId,
      restrictions,
    });

    setParticipantsMetadata((prev) => ({
      ...prev,
      [participantId]: {
        ...prev[participantId],
        role: 'host',
        hostAccess: true,
        hostAccessRestrictions: restrictions,
      },
    }));
  }, [computeIsHost, sendSignalingMessage]);

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
        email: getEmailFromUrl() || currentUser.current?.email || sessionStorage.getItem(`meeting_email_${roomId}`) || null,
        picture: getUserPicture(currentUser.current) || null
      }
    });
  }, [roomId, sendSignalingMessage]);

  const refreshWaitingRoom = useCallback(async () => {
    if (!isHost.current && !computeIsHost() && !sharedHostAccess) {
      return;
    }

    try {
      const response = await fetch(buildApiUrl(`/api/meetings/${roomId}/waiting-room`));
      if (!response.ok) {
        return;
      }

      const data = await response.json();
      setActiveJoinRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch (error) {
      console.warn('[WebRTC] Failed to refresh waiting room:', error);
    }
  }, [computeIsHost, roomId, sharedHostAccess]);

  useEffect(() => {
    if (!isHostState && !sharedHostAccess) {
      return undefined;
    }

    refreshWaitingRoom();
    const intervalId = window.setInterval(refreshWaitingRoom, 2000);
    return () => window.clearInterval(intervalId);
  }, [isHostState, refreshWaitingRoom, sharedHostAccess]);

  const toggleVideo = useCallback(async () => {
    // Check for a real camera track (not canvas dummy) in originalStream
    const realVideoTrack = originalStream.current?.getVideoTracks()
      .find(t => t.readyState === 'live' && !t.label?.toLowerCase().includes('canvas'));

    if (realVideoTrack) {
      // Toggle it on/off
      realVideoTrack.enabled = !realVideoTrack.enabled;
      const newState = realVideoTrack.enabled;
      await replaceTrackForAllPeers('video', realVideoTrack);
      setIsVideoEnabled(newState);
      setParticipantsMetadata((prev) => ({
        ...prev,
        [clientId.current]: { ...prev[clientId.current] || {}, isVideoEnabled: newState },
      }));
      syncParticipantState({ isVideoEnabled: newState });
      await renegotiateAllPeers();
    } else {
      // No real camera yet — acquire one and replace dummy in all PCs
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const newTrack = camStream.getVideoTracks()[0];
        if (!newTrack) return;

        await replaceTrackForAllPeers('video', newTrack);

        // Update originalStream with real camera
        if (originalStream.current) {
          originalStream.current.getVideoTracks().forEach(t => { t.stop(); originalStream.current.removeTrack(t); });
          originalStream.current.addTrack(newTrack);
        } else {
          originalStream.current = new MediaStream([newTrack]);
        }

        // Create a new MediaStream so React detects the change
        const next = new MediaStream();
        (currentOutgoingStreamRef.current || originalStream.current)?.getAudioTracks().forEach(t => next.addTrack(t));
        next.addTrack(newTrack);
        
        publishLocalStream(next, { camera: true });

        setIsVideoEnabled(true);
        setParticipantsMetadata((prev) => ({
          ...prev,
          [clientId.current]: { ...prev[clientId.current] || {}, isVideoEnabled: true },
        }));
        syncParticipantState({ isVideoEnabled: true });
        await renegotiateAllPeers();
      } catch (e) {
        console.error('[toggleVideo] Failed to acquire camera:', e);
      }
    }
  }, [publishLocalStream, renegotiateAllPeers, replaceTrackForAllPeers, syncParticipantState]);


  const toggleAudio = useCallback(async () => {
    let newState;
    let baseStream = currentOutgoingStreamRef.current || originalStream.current;
    if (!baseStream) {
      baseStream = new MediaStream();
      originalStream.current = baseStream;
      currentOutgoingStreamRef.current = baseStream;
    }

    const audioTrack = baseStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      newState = audioTrack.enabled;
      await replaceTrackForAllPeers('audio', audioTrack);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const newTrack = stream.getAudioTracks()[0];
        if (newTrack) {
          baseStream.addTrack(newTrack);
          activeStreamsRef.current.push(stream);
          await replaceTrackForAllPeers('audio', newTrack);
          publishLocalStream(baseStream, { camera: baseStream === originalStream.current });
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
    await renegotiateAllPeers();
  }, [publishLocalStream, renegotiateAllPeers, replaceTrackForAllPeers, syncParticipantState]);

  const stopScreenShare = useCallback((screenTrack) => {
    if (screenTrack) { screenTrack.stop(); screenTrack.onended = null; }

    const cameraTrack = originalStream.current?.getVideoTracks()
      .find(t => t.readyState === 'live' && !t.label?.toLowerCase().includes('canvas')) || null;

    replaceTrackForAllPeers('video', cameraTrack);

    publishLocalStream(originalStream.current, { camera: true });
    setIsSharingScreen(false);
    setParticipantsMetadata((prev) => ({
      ...prev,
      [clientId.current]: { ...prev[clientId.current], isSharingScreen: false },
    }));
    syncParticipantState({ isSharingScreen: false });
    renegotiateAllPeers();
  }, [publishLocalStream, renegotiateAllPeers, replaceTrackForAllPeers, syncParticipantState]);

  const toggleScreenShare = useCallback(async () => {
    try {
      if (!isSharingScreen) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' },
          audio: false,
        });

        activeStreamsRef.current.push(screenStream);
        const screenTrack = screenStream.getVideoTracks()[0];

        await replaceTrackForAllPeers('video', screenTrack);

        screenTrack.onended = () => stopScreenShare(screenTrack);

        const newLocalStream = new MediaStream();
        originalStream.current?.getAudioTracks().forEach(t => newLocalStream.addTrack(t));
        newLocalStream.addTrack(screenTrack);

        publishLocalStream(newLocalStream);
        setIsSharingScreen(true);
        setParticipantsMetadata((prev) => ({
          ...prev,
          [clientId.current]: { ...prev[clientId.current] || {}, isSharingScreen: true },
        }));
        syncParticipantState({ isSharingScreen: true });
        await renegotiateAllPeers();
      } else {
        const screenTrack = currentOutgoingStreamRef.current?.getVideoTracks?.()?.[0];
        stopScreenShare(screenTrack);
      }
    } catch (error) {
      console.error('[ScreenShare] Error:', error);
      setIsSharingScreen(false);
    }
  }, [isSharingScreen, localStream, publishLocalStream, replaceTrackForAllPeers, stopScreenShare, syncParticipantState]);


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
      role: isHost.current ? 'host' : (sharedHostAccess ? 'co-host' : 'participant'),
      hostAccess: Boolean(sharedHostAccess),
      hostAccessRestrictions: sharedHostAccess?.restrictions || null,
      isHandRaised: nextState,
      isSharingScreen,
      isAudioEnabled,
      isVideoEnabled,
    });
  }, [isAudioEnabled, isHandRaised, isSharingScreen, isVideoEnabled, sendSignalingMessage, sharedHostAccess]);

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
    removeParticipant,
    grantHostAccess,
    requestToJoin,
    activeJoinRequests,
    isHost: isHostState,
    sharedHostAccess,
    canManageParticipants: isHostState || Boolean(sharedHostAccess),
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
