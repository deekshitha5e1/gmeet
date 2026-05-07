import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Mic, MicOff, Video, VideoOff, MoreVertical, Monitor, Sparkles, LogIn, X, Link, ChevronDown, Grid } from 'lucide-react';
import MeetingHeader from '../components/MeetingHeader';
import { motion, AnimatePresence } from 'framer-motion';
import { useWebRTC } from '../hooks/useWebRTC';
import InviteModal from '../components/InviteModal';
import ProfileAvatar from '../components/ProfileAvatar';
import { getPreJoinMediaState, getPreferredMediaConstraints, savePreJoinMediaState } from '../utils/meetingUtils';
import { getCurrentUser } from '../utils/currentUser';
import { buildApiUrl } from '../utils/api';

export default function LobbyPage() {
  const { id: roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const videoRef = useRef(null);

  // ── Role detection (synchronous, from sessionStorage/localStorage) ──────────
  const roleFromLink = new URLSearchParams(location.search).get('role');
  const emailFromLink = new URLSearchParams(location.search).get('email');
  const storedRole = sessionStorage.getItem(`meeting_role_${roomId}`);
  const normalizedCurrentEmail = (emailFromLink || currentUser?.email || '').trim().toLowerCase();
  const storedHostEmail = (localStorage.getItem(`meeting_host_${roomId}`) || '').trim().toLowerCase();
  const storedHostFlag =
    Boolean(normalizedCurrentEmail && storedHostEmail && storedHostEmail === normalizedCurrentEmail) ||
    Boolean(storedHostEmail === `id:${currentUser?.meetingUserId}`);

  const getInitialRole = () => {
    if (roleFromLink === 'host' || storedRole === 'host' || storedHostFlag) return 'host';
    if (roleFromLink === 'participant' || storedRole === 'participant') return 'participant';
    return undefined;
  };

  const [resolvedRole, setResolvedRole] = useState(getInitialRole);
  const [stream, setStream] = useState(null);
  const initialMediaState = getPreJoinMediaState(roomId);
  const [isMicOn, setIsMicOn] = useState(initialMediaState.audioEnabled);
  const [isVideoOn, setIsVideoOn] = useState(initialMediaState.videoEnabled);
  const storedName = sessionStorage.getItem(`meeting_name_${roomId}`) || currentUser?.name || 'Guest';
  const [participantName, setParticipantName] = useState(storedName);
  const [toastMessage, setToastMessage] = useState(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showEffectsModule, setShowEffectsModule] = useState(false);
  const [videoEffect, setVideoEffect] = useState('none');

  const toastTimeoutRef = useRef(null);
  const hostJoinSentRef = useRef(false);

  const {
    isHost,
    activeJoinRequests,
    admitParticipant,
    denyParticipant,
    sendSignalingMessage,
    isWSConnected,
    requestToJoin,
  } = useWebRTC(roomId, { acquireMedia: false, autoJoin: false, initialRole: resolvedRole });

  // ── Toast helper ─────────────────────────────────────────────────────────────
  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 3500);
  }, []);

  // ── Async host verification from backend ─────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    const verify = async () => {
      try {
        const res = await fetch(buildApiUrl(`/api/meetings/${roomId}`));
        if (!res.ok) return;
        const data = await res.json();
        const hostEmail = (data.host_email || '').trim().toLowerCase();
        const isBackendHost = Boolean(
          data.valid && (
            (data.host_id && currentUser?.meetingUserId === data.host_id) ||
            (hostEmail && normalizedCurrentEmail === hostEmail)
          )
        );
        const effectivelyHost = isBackendHost || isHost;
        if (effectivelyHost) {
          const hostValue = normalizedCurrentEmail || `id:${currentUser?.meetingUserId}`;
          localStorage.setItem(`meeting_host_${roomId}`, hostValue);
          sessionStorage.setItem(`meeting_role_${roomId}`, 'host');
          sessionStorage.setItem(`meeting_name_${roomId}`, currentUser?.name || storedName);
          if (normalizedCurrentEmail) sessionStorage.setItem(`meeting_email_${roomId}`, normalizedCurrentEmail);
          setResolvedRole('host');
        } else {
          const invitedEmails = data.invited_emails || [];
          const isInvited = invitedEmails.some(e => e.toLowerCase() === normalizedCurrentEmail);
          
          if (isInvited) {
            sessionStorage.setItem(`meeting_role_${roomId}`, 'participant');
            if (normalizedCurrentEmail) sessionStorage.setItem(`meeting_email_${roomId}`, normalizedCurrentEmail);
            setResolvedRole('participant');
            // Auto-join and Auto-admit removed as per user request. 
          } else if (!storedHostFlag) {
            sessionStorage.setItem(`meeting_role_${roomId}`, 'participant');
            if (normalizedCurrentEmail) sessionStorage.setItem(`meeting_email_${roomId}`, normalizedCurrentEmail);
            setResolvedRole('participant');
          }
        }
      } catch (err) {
        console.error('Failed to verify host/invitation status:', err);
      }
    };
    verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ── Send host_join whenever role confirms as host ─────────────────────────────
  // Uses a ref guard so we only send once per lobby session.
  useEffect(() => {
    if (resolvedRole === 'host' && sendSignalingMessage && !hostJoinSentRef.current) {
      hostJoinSentRef.current = true;
      sendSignalingMessage({ type: 'host_join' });
    }
  }, [resolvedRole, sendSignalingMessage]);

  // ── Re-send host_join if WS reconnects (sendSignalingMessage ref changes) ────
  // This handles the case where WS wasn't open when host_join was first queued.
  const prevSendRef = useRef(null);
  useEffect(() => {
    if (resolvedRole === 'host' && sendSignalingMessage && prevSendRef.current !== sendSignalingMessage) {
      prevSendRef.current = sendSignalingMessage;
      sendSignalingMessage({ type: 'host_join' });
    }
  }, [resolvedRole, sendSignalingMessage]);

  // ── Preview camera ────────────────────────────────────────────────────────────
  useEffect(() => {
    let localStream = null;
    const startPreview = async () => {
      try {
        localStream = await navigator.mediaDevices.getUserMedia(getPreferredMediaConstraints());
        const audioTrack = localStream.getAudioTracks()[0];
        const videoTrack = localStream.getVideoTracks()[0];
        if (audioTrack) audioTrack.enabled = initialMediaState.audioEnabled;
        if (videoTrack) videoTrack.enabled = initialMediaState.videoEnabled;
        setStream(localStream);
        if (videoRef.current) videoRef.current.srcObject = localStream;
      } catch (err) {
        console.error('Preview media error:', err);
      }
    };
    startPreview();
    return () => { localStream?.getTracks().forEach(t => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    savePreJoinMediaState(roomId, { audioEnabled: isMicOn, videoEnabled: isVideoOn });
  }, [isMicOn, isVideoOn, roomId]);

  // ── Handle admitted / denied events from WS ───────────────────────────────────
  useEffect(() => {
    const onAdmitted = (e) => {
      if (e.detail.roomId !== roomId) return;
      setIsWaiting(false);
      // Navigate to room — admitted flag set in joinMeeting
      const name = participantName.trim() || currentUser?.name || 'Guest';
      sessionStorage.setItem(`meeting_name_${roomId}`, name);
      sessionStorage.setItem(`meeting_admitted_${roomId}`, 'true');
      savePreJoinMediaState(roomId, { audioEnabled: isMicOn, videoEnabled: isVideoOn });
      stream?.getTracks().forEach(t => t.stop());
      navigate(`/room/${roomId}`);
    };
    const onDenied = (e) => {
      if (e.detail.roomId !== roomId) return;
      setIsWaiting(false);
      showToast('The host denied your join request.');
    };
    window.addEventListener('meeting-admitted', onAdmitted);
    window.addEventListener('meeting-denied', onDenied);
    return () => {
      window.removeEventListener('meeting-admitted', onAdmitted);
      window.removeEventListener('meeting-denied', onDenied);
    };
  }, [roomId, participantName, isMicOn, isVideoOn, stream, currentUser?.name, navigate, showToast]);

  const toggleMic = () => {
    const newState = !isMicOn;
    if (stream) { const t = stream.getAudioTracks()[0]; if (t) t.enabled = newState; }
    setIsMicOn(newState);
    showToast(newState ? 'Microphone on' : 'Microphone muted');
  };

  const toggleVideo = () => {
    const newState = !isVideoOn;
    if (stream) { const t = stream.getVideoTracks()[0]; if (t) t.enabled = newState; }
    setIsVideoOn(newState);
    showToast(newState ? 'Camera on' : 'Camera off');
  };

  // ── Ask to join (participant) ─────────────────────────────────────────────────
  const handleAskToJoin = () => {
    const name = participantName.trim() || currentUser?.name || 'Guest';
    setParticipantName(name);
    sessionStorage.setItem(`meeting_name_${roomId}`, name);
    setIsWaiting(true);
    requestToJoin(name);
    showToast('Asking to join… please wait for the host.');
  };

  // ── Host joins meeting directly ───────────────────────────────────────────────
  const joinMeeting = () => {
    const name = participantName.trim() || currentUser?.name || 'Host';
    sessionStorage.setItem(`meeting_name_${roomId}`, name);
    sessionStorage.setItem(`meeting_admitted_${roomId}`, 'true');
    savePreJoinMediaState(roomId, { audioEnabled: isMicOn, videoEnabled: isVideoOn });
    stream?.getTracks().forEach(t => t.stop());
    navigate(`/room/${roomId}`);
  };

  const isHostView = isHost || resolvedRole === 'host';

  return (
    <div className="flex flex-col h-screen bg-white font-sans overflow-hidden">
      <MeetingHeader />

      <main className="flex-1 flex flex-col lg:flex-row items-center justify-center p-4 sm:p-6 lg:p-12 gap-8 lg:gap-16 max-w-7xl mx-auto w-full overflow-y-auto">
        {/* Left: Video Preview */}
        <div className="flex-[1.4] w-full flex flex-col items-center">
          <div className="w-full max-w-2xl">
            <div className="relative aspect-video bg-gray-900 rounded-lg shadow-xl overflow-hidden group">
              {isVideoOn ? (
                <video ref={videoRef} autoPlay muted playsInline
                  className="w-full h-full object-cover mirror transition-all duration-300"
                  style={{ filter: videoEffect !== 'none' ? videoEffect : 'none' }} />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900">
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center space-y-6">
                    <h3 className="text-white text-xl md:text-2xl font-normal max-w-md leading-relaxed">
                      Do you want people to see and hear you in the meeting?
                    </h3>
                    <button onClick={() => { setIsMicOn(true); setIsVideoOn(true); }}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-md font-medium transition-all">
                      Allow microphone and camera
                    </button>
                  </div>
                </div>
              )}

              <div className="absolute top-4 left-4 text-white text-sm font-medium drop-shadow-md">You</div>

              <button onClick={() => showToast('Additional settings are currently unavailable.')}
                className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full text-white transition-colors">
                <MoreVertical size={20} />
              </button>

              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3">
                <button onClick={toggleMic}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isMicOn ? 'bg-white/10 hover:bg-white/20 text-white border border-white/20' : 'bg-red-500 text-white border border-red-400 shadow-lg'}`}>
                  {isMicOn ? <Mic size={22} /> : <MicOff size={22} />}
                </button>
                <button onClick={toggleVideo}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isVideoOn ? 'bg-white/10 hover:bg-white/20 text-white border border-white/20' : 'bg-red-500 text-white border border-red-400 shadow-lg'}`}>
                  {isVideoOn ? <Video size={22} /> : <VideoOff size={22} />}
                </button>
                <button onClick={() => setShowEffectsModule(!showEffectsModule)}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${showEffectsModule ? 'bg-blue-600 text-white shadow-lg border border-blue-500' : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'}`}>
                  <Grid size={22} />
                </button>
              </div>

              {showEffectsModule && (
                <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-gray-900/90 backdrop-blur-md rounded-xl p-3 flex gap-4 shadow-2xl border border-gray-700">
                  <EffectOption label="None" isActive={videoEffect === 'none'} onClick={() => setVideoEffect('none')} />
                  <EffectOption label="Vibrant" isActive={videoEffect === 'saturate(1.5) contrast(1.1)'} onClick={() => setVideoEffect('saturate(1.5) contrast(1.1)')} />
                  <EffectOption label="Warm" isActive={videoEffect === 'sepia(0.5) contrast(1.1)'} onClick={() => setVideoEffect('sepia(0.5) contrast(1.1)')} />
                  <EffectOption label="B&W" isActive={videoEffect === 'grayscale(1)'} onClick={() => setVideoEffect('grayscale(1)')} />
                  <EffectOption label="Blur" isActive={videoEffect === 'blur(6px)'} onClick={() => setVideoEffect('blur(6px)')} />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 mt-4 pb-2 px-2">
              <PermissionPill icon={<Mic size={14} />} label="Permission n..." onClick={() => showToast('Manage microphone in browser settings.')} />
              <PermissionPill icon={<Monitor size={14} />} label="Permission n..." onClick={() => showToast('Manage screenshare in browser settings.')} />
              <PermissionPill icon={<Video size={14} />} label="Permission n..." onClick={() => showToast('Manage camera in browser settings.')} />
              <PermissionPill icon={<Sparkles size={14} />} label="Permission n..." onClick={() => showToast('Effects are currently disabled.')} />
            </div>
          </div>
        </div>

        {/* Right: Join Panel */}
        <div className="flex-1 w-full max-sm flex flex-col items-center justify-center space-y-6">
          <h2 className="text-3xl font-normal text-gray-800">Ready to join?</h2>

          <div className="w-full">
            <label htmlFor="participant-name" className="mb-2 block text-sm font-medium text-gray-600">Your name</label>
            <input id="participant-name" type="text" value={participantName}
              onChange={(e) => setParticipantName(e.target.value)}
              placeholder="Enter your name"
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-gray-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </div>

          <div className="w-full space-y-4 pt-4">
            {isHostView ? (
              <div className="space-y-4 w-full">
                <button onClick={joinMeeting} disabled={!participantName.trim() || !isWSConnected}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-full shadow-lg shadow-blue-100 transition-all transform active:scale-95 text-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                  <LogIn size={20} /> {isWSConnected ? 'Join the meet' : 'Connecting...'}
                </button>

                <button onClick={() => setShowInviteModal(true)}
                  className="w-full bg-white border border-gray-300 text-gray-700 font-medium py-3 rounded-full hover:bg-gray-50 transition-all flex items-center justify-center gap-2">
                  <Link size={18} /> Invite people
                </button>

                {activeJoinRequests.length > 0 && (
                  <div className="mt-6 text-left">
                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
                      Waiting in lobby ({activeJoinRequests.length})
                    </h3>
                    <div className="space-y-2">
                      {activeJoinRequests.map(req => (
                        <div key={req.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                          <div className="flex items-center gap-3">
                            <ProfileAvatar name={req.name} picture={req.picture} className="w-10 h-10" textClass="text-xs" />
                            <div>
                              <div className="text-sm font-medium text-gray-700">{req.name}</div>
                              <div className="text-xs text-gray-400">Waiting in lobby</div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => admitParticipant(req.id)}
                              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
                              Accept
                            </button>
                            <button onClick={() => denyParticipant(req.id)}
                              className="px-3 py-1.5 bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium">
                              Deny
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <button onClick={sessionStorage.getItem(`meeting_admitted_${roomId}`) === 'true' ? joinMeeting : handleAskToJoin} 
                  disabled={isWaiting || !participantName.trim() || !isWSConnected}
                  className={`w-full font-semibold py-3.5 rounded-full shadow-lg transition-all transform active:scale-95 text-md ${isWaiting ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-100'} disabled:opacity-50 disabled:cursor-not-allowed`}>
                  {sessionStorage.getItem(`meeting_admitted_${roomId}`) === 'true' ? (isWSConnected ? 'Join meeting' : 'Connecting...') : (isWaiting ? 'Asking to join…' : (isWSConnected ? 'Ask to join' : 'Connecting...'))}
                </button>

                {isWaiting && (
                  <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700 text-center font-medium animate-pulse">
                    The host will let you in soon, please wait.
                  </div>
                )}

                <button className="w-full flex items-center justify-center gap-2 text-gray-700 hover:bg-gray-100 font-medium py-3 rounded-md border border-gray-200 transition-all text-sm group">
                  Other ways to join <ChevronDown size={16} className="text-gray-400 group-hover:text-gray-600" />
                </button>
              </>
            )}
          </div>
        </div>
      </main>

      <AnimatePresence>
        {toastMessage && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-gray-800/90 backdrop-blur-md text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 z-50 border border-gray-700/50">
            <span className="text-sm font-medium">{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <InviteModal isOpen={showInviteModal} onClose={() => setShowInviteModal(false)} roomId={roomId} />

      <style>{`.mirror { transform: scaleX(-1); }`}</style>
    </div>
  );
}

function EffectOption({ label, isActive, onClick }) {
  return (
    <button onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-transform hover:scale-105 ${isActive ? 'text-blue-400' : 'text-gray-300 hover:text-white'}`}>
      <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-xs font-semibold ${isActive ? 'bg-blue-600/20 border-2 border-blue-500' : 'bg-gray-800 border border-gray-600'}`}>✨</div>
      <span className="text-[10px] font-medium tracking-wide">{label}</span>
    </button>
  );
}

function PermissionPill({ icon, label, onClick }) {
  return (
    <div onClick={onClick} className="flex items-center gap-2 pl-3 pr-2 py-1.5 border border-gray-100 rounded-full hover:bg-gray-50 cursor-pointer transition-colors group">
      <span className="text-gray-400 group-hover:text-blue-500">{icon}</span>
      <span className="text-[11px] text-gray-500 font-medium truncate max-w-[80px]">{label}</span>
      <ChevronDown size={14} className="text-gray-300" />
    </div>
  );
}
