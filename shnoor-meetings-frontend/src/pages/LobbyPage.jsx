import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Mic, MicOff, Video, VideoOff, MoreVertical, Monitor, Sparkles, LogIn, X, Link, ChevronDown, Grid } from 'lucide-react';
import MeetingHeader from '../components/MeetingHeader';
import { motion, AnimatePresence } from 'framer-motion';
import { useWebRTC } from '../hooks/useWebRTC';
import InviteModal from '../components/InviteModal';
import { getPreJoinMediaState, getPreferredMediaConstraints, savePreJoinMediaState } from '../utils/meetingUtils';
import { getCurrentUser } from '../utils/currentUser';
import { buildApiUrl } from '../utils/api';

export default function LobbyPage() {
  const { id: roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const videoRef = useRef(null);
  const roleFromLink = new URLSearchParams(location.search).get('role');
  const storedRole = sessionStorage.getItem(`meeting_role_${roomId}`);
  const normalizedCurrentEmail = (getCurrentUser()?.email || '').trim().toLowerCase();
  const storedHostEmail = (localStorage.getItem(`meeting_host_${roomId}`) || '').trim().toLowerCase();
  const storedHostFlag = Boolean(normalizedCurrentEmail && storedHostEmail && storedHostEmail === normalizedCurrentEmail);
  const storedParticipantName = sessionStorage.getItem(`meeting_name_${roomId}`) || currentUser?.name || 'Guest';
  const [resolvedRole, setResolvedRole] = useState(() => (storedRole === 'host' || storedHostFlag
    ? 'host'
    : roleFromLink === 'participant'
      ? 'participant'
      : storedRole === 'participant'
        ? 'participant'
        : undefined));
  const [stream, setStream] = useState(null);
  const initialMediaState = getPreJoinMediaState(roomId);
  const [isMicOn, setIsMicOn] = useState(initialMediaState.audioEnabled);
  const [isVideoOn, setIsVideoOn] = useState(initialMediaState.videoEnabled);
  const [participantName, setParticipantName] = useState(storedParticipantName);
  const [toastMessage, setToastMessage] = useState(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showEffectsModule, setShowEffectsModule] = useState(false);
  const [videoEffect, setVideoEffect] = useState('none');
  
  const { 
    isHost, 
    activeJoinRequests, 
    admitParticipant, 
    denyParticipant,
    requestToJoin 
  } = useWebRTC(roomId, { acquireMedia: false, autoJoin: false, initialRole: resolvedRole });

  const toastTimeoutRef = useRef(null);
  const joinMeetingRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const roleFromLink = params.get('role');

    if (storedHostFlag) {
      sessionStorage.setItem(`meeting_role_${roomId}`, 'host');
      sessionStorage.setItem(`meeting_name_${roomId}`, currentUser?.name || storedParticipantName);
      setResolvedRole('host');
    } else if (roleFromLink === 'participant') {
      sessionStorage.setItem(`meeting_role_${roomId}`, 'participant');
      sessionStorage.removeItem(`meeting_admitted_${roomId}`);
      setResolvedRole('participant');
    } else if (storedRole === 'participant') {
      sessionStorage.removeItem(`meeting_admitted_${roomId}`);
      setResolvedRole('participant');
    }
  }, [currentUser?.name, location.search, roomId, storedHostFlag, storedParticipantName, storedRole]);

  useEffect(() => {
    const checkHostDirectAdmin = async () => {
      try {
        const response = await fetch(buildApiUrl(`/api/meetings/${roomId}`));
        if (response.ok) {
          const data = await response.json();
          const normalizedHostEmail = (data.host_email || '').trim().toLowerCase();
          const isMeetingHost = Boolean(
            data.valid && (
              (data.host_id && currentUser?.meetingUserId === data.host_id) ||
              (normalizedHostEmail && normalizedCurrentEmail === normalizedHostEmail)
            )
          );

          if (isMeetingHost) {
            localStorage.setItem(`meeting_host_${roomId}`, normalizedCurrentEmail);
            sessionStorage.setItem(`meeting_role_${roomId}`, 'host');
            sessionStorage.setItem(`meeting_name_${roomId}`, currentUser?.name || storedParticipantName);
            setResolvedRole('host');
          } else {
            sessionStorage.setItem(`meeting_role_${roomId}`, 'participant');
            setResolvedRole('participant');
          }
        }
      } catch (err) {
        console.error('Failed to verify admin status:', err);
      }
    };
    
    if (roomId) {
      checkHostDirectAdmin();
    }
  }, [currentUser?.meetingUserId, currentUser?.name, normalizedCurrentEmail, roomId, storedParticipantName]);

  useEffect(() => {
    setParticipantName(sessionStorage.getItem(`meeting_name_${roomId}`) || currentUser?.name || 'Guest');
  }, [currentUser?.name, roomId]);

  useEffect(() => {
    savePreJoinMediaState(roomId, { audioEnabled: isMicOn, videoEnabled: isVideoOn });
  }, [isMicOn, isVideoOn, roomId]);

  const showToast = (message) => {
    setToastMessage(message);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  useEffect(() => {
    async function startPreview() {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ 
          ...getPreferredMediaConstraints(),
        });
        const audioTrack = mediaStream.getAudioTracks()[0];
        const videoTrack = mediaStream.getVideoTracks()[0];
        if (audioTrack) {
          audioTrack.enabled = initialMediaState.audioEnabled;
        }
        if (videoTrack) {
          videoTrack.enabled = initialMediaState.videoEnabled;
        }
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.error("Error accessing media devices for preview:", err);
      }
    }
    startPreview();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const toggleMic = () => {
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      const newState = !isMicOn;
      if (audioTrack) audioTrack.enabled = newState;
      setIsMicOn(newState);
      showToast(newState ? "Microphone is turned on" : "Microphone is muted");
    } else {
      const newState = !isMicOn;
      setIsMicOn(newState);
      showToast(newState ? "Microphone is turned on" : "Microphone is muted");
    }
  };

  const toggleVideo = () => {
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      const newState = !isVideoOn;
      if (videoTrack) videoTrack.enabled = newState;
      setIsVideoOn(newState);
      showToast(newState ? "Camera is turned on" : "Camera is turned off");
    } else {
      const newState = !isVideoOn;
      setIsVideoOn(newState);
      showToast(newState ? "Camera is turned on" : "Camera is turned off");
    }
  };

  useEffect(() => {
    const handleAdmitted = (e) => {
      if (e.detail.roomId === roomId) {
        setIsWaiting(false);
        joinMeetingRef.current?.();
      }
    };
    const handleDenied = (e) => {
      if (e.detail.roomId === roomId) {
        setIsWaiting(false);
        showToast('The host denied your join request.');
      }
    };
    window.addEventListener('meeting-admitted', handleAdmitted);
    window.addEventListener('meeting-denied', handleDenied);
    return () => {
      window.removeEventListener('meeting-admitted', handleAdmitted);
      window.removeEventListener('meeting-denied', handleDenied);
    };
  }, [roomId]);

  const handleAskToJoin = () => {
    const trimmedName = participantName.trim() || currentUser?.name || 'Guest';
    setParticipantName(trimmedName);
    setIsWaiting(true);
    requestToJoin(trimmedName);
    showToast("Waiting for host to accept...");
  };

  const joinMeeting = () => {
    const trimmedName = participantName.trim() || currentUser?.name || (resolvedRole === 'host' ? 'Host' : 'Guest');
    sessionStorage.setItem(`meeting_name_${roomId}`, trimmedName);
    sessionStorage.setItem(`meeting_admitted_${roomId}`, 'true');
    savePreJoinMediaState(roomId, { audioEnabled: isMicOn, videoEnabled: isVideoOn });
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    navigate(`/room/${roomId}`);
  };

  // Keep ref updated so the admitted event listener always calls the latest joinMeeting
  joinMeetingRef.current = joinMeeting;

  return (
    <div className="flex flex-col h-screen bg-white font-sans overflow-hidden transition-all">
      <MeetingHeader />

      <main className="flex-1 flex flex-col md:flex-row items-center justify-center p-6 md:p-12 gap-8 md:gap-16 max-w-7xl mx-auto w-full">
        {/* Left Side: Video Preview & Settings */}
        <div className="flex-[1.4] w-full flex flex-col items-center">
          <div className="w-full max-w-2xl">
            <div 
              className="relative aspect-video bg-gray-900 rounded-lg shadow-xl overflow-hidden group"
            >
              {isVideoOn ? (
                <video 
                  ref={videoRef} 
                  autoPlay 
                  muted 
                  playsInline 
                  className="w-full h-full object-cover mirror transition-all duration-300"
                  style={{ filter: videoEffect !== 'none' ? videoEffect : 'none' }}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900">
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center space-y-6">
                    <h3 className="text-white text-xl md:text-2xl font-normal max-w-md leading-relaxed">
                      Do you want people to see and hear you in the meeting?
                    </h3>
                    <button 
                      onClick={() => { setIsMicOn(true); setIsVideoOn(true); }}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-md font-medium transition-all"
                    >
                      Allow microphone and camera
                    </button>
                  </div>
                </div>
              )}
              
              {/* Name Overlay */}
              <div className="absolute top-4 left-4 text-white text-sm font-medium drop-shadow-md">
                You
              </div>

              {/* Three Dots Menu */}
              <button 
                onClick={() => showToast("Additional settings are currently unavailable.")}
                className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full text-white transition-colors"
                title="More options"
              >
                <MoreVertical size={20} />
              </button>

              {/* Round Controls at Bottom */}
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3">
                <button 
                  onClick={toggleMic}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isMicOn ? 'bg-white/10 hover:bg-white/20 text-white border border-white/20' : 'bg-red-500 text-white border border-red-400 shadow-lg'}`}
                >
                  {isMicOn ? <Mic size={22} /> : <MicOff size={22} />}
                  {!isMicOn && <span className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 border-2 border-white rounded-full flex items-center justify-center text-[10px] text-black font-bold">!</span>}
                </button>
                <button 
                  onClick={toggleVideo}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isVideoOn ? 'bg-white/10 hover:bg-white/20 text-white border border-white/20' : 'bg-red-500 text-white border border-red-400 shadow-lg'}`}
                >
                  {isVideoOn ? <Video size={22} /> : <VideoOff size={22} />}
                  {!isVideoOn && <span className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 border-2 border-white rounded-full flex items-center justify-center text-[10px] text-black font-bold">!</span>}
                </button>
                <button 
                  onClick={() => setShowEffectsModule(!showEffectsModule)}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${showEffectsModule ? 'bg-blue-600 text-white shadow-lg border border-blue-500' : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'}`}
                  title="Visual Effects"
                >
                  <Grid size={22} />
                </button>
              </div>

              {/* Effects Popup Module */}
              {showEffectsModule && (
                <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-gray-900/90 backdrop-blur-md rounded-xl p-3 flex gap-4 shadow-2xl border border-gray-700 animate-in slide-in-from-bottom-4 duration-300">
                   <EffectOption label="None" isActive={videoEffect === 'none'} onClick={() => setVideoEffect('none')} />
                   <EffectOption label="Vibrant" isActive={videoEffect === 'saturate(1.5) contrast(1.1)'} onClick={() => setVideoEffect('saturate(1.5) contrast(1.1)')} />
                   <EffectOption label="Warm" isActive={videoEffect === 'sepia(0.5) contrast(1.1)'} onClick={() => setVideoEffect('sepia(0.5) contrast(1.1)')} />
                   <EffectOption label="B&W" isActive={videoEffect === 'grayscale(1)'} onClick={() => setVideoEffect('grayscale(1)')} />
                   <EffectOption label="Blur" isActive={videoEffect === 'blur(6px)'} onClick={() => setVideoEffect('blur(6px)')} />
                </div>
              )}
            </div>

            {/* Permission Pills at bottom of video box */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-4 overflow-x-auto pb-2">
              <PermissionPill icon={<Mic size={14}/>} label="Permission n..." onClick={() => showToast("Microphone permissions must be managed in your browser settings.")} />
              <PermissionPill icon={<Monitor size={14}/>} label="Permission n..." onClick={() => showToast("Screenshare permissions must be managed in your browser settings.")} />
              <PermissionPill icon={<Video size={14}/>} label="Permission n..." onClick={() => showToast("Camera permissions must be managed in your browser settings.")} />
              <PermissionPill icon={<Sparkles size={14}/>} label="Permission n..." onClick={() => showToast("Effects are currently disabled.")} />
            </div>
          </div>
        </div>

        {/* Right Side: Join Panel */}
        <div className="flex-1 w-full max-w-sm flex flex-col items-center justify-center space-y-6">
          <h2 className="text-3xl font-normal text-gray-800">Ready to join?</h2>
          <div className="w-full">
            <label htmlFor="participant-name" className="mb-2 block text-sm font-medium text-gray-600">
              Your name
            </label>
            <input
              id="participant-name"
              type="text"
              value={participantName}
              onChange={(e) => setParticipantName(e.target.value)}
              placeholder="Enter your name"
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-gray-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div className="w-full space-y-4 pt-4">
            {isHost ? (
              <div className="space-y-4 w-full">
                <button 
                  onClick={joinMeeting}
                  disabled={!participantName.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-full shadow-lg shadow-blue-100 transition-all transform active:scale-95 text-md flex items-center justify-center gap-2"
                >
                  <LogIn size={20} />
                  Join Meeting
                </button>

                <button 
                  onClick={() => setShowInviteModal(true)}
                  className="w-full bg-white border border-gray-300 text-gray-700 font-medium py-3 rounded-full hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
                >
                  <Link size={18} />
                  Invite people
                </button>
                
                {activeJoinRequests.length > 0 && (
                  <div className="mt-8 text-left animate-in slide-in-from-bottom-4 duration-500">
                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Waiting in lobby ({activeJoinRequests.length})</h3>
                    <div className="space-y-2">
                      {activeJoinRequests.map(req => (
                        <div key={req.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">
                              {req.name.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-700">{req.name}</div>
                              <div className="text-xs text-gray-500">Waiting in lobby</div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => admitParticipant(req.id)}
                              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                              title="Accept"
                            >
                              Accept
                            </button>
                            <button
                              onClick={() => denyParticipant(req.id)}
                              className="px-3 py-1.5 bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium"
                              title="Deny"
                            >
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
                <button 
                  onClick={handleAskToJoin}
                  disabled={isWaiting || !participantName.trim()}
                  className={`w-full font-semibold py-3.5 rounded-full shadow-lg transition-all transform active:scale-95 text-md ${isWaiting ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-100'}`}
                >
                  {isWaiting ? 'Waiting to be let in...' : 'Ask to join'}
                </button>

                {isWaiting && (
                  <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                    Waiting for host to accept...
                  </div>
                )}
                
                <button className="w-full flex items-center justify-center gap-2 text-gray-700 hover:bg-gray-100 font-medium py-3 rounded-md border border-gray-200 transition-all text-sm group">
                  Other ways to join
                  <ChevronDown size={16} className="text-gray-400 group-hover:text-gray-600" />
                </button>
              </>
            )}
          </div>
        </div>
      </main>

      {/* Toast Message */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-gray-800/90 backdrop-blur-md text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 z-50 border border-gray-700/50"
          >
            <span className="text-sm font-medium">{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <InviteModal 
        isOpen={showInviteModal} 
        onClose={() => setShowInviteModal(false)} 
        roomId={roomId} 
      />

      <style jsx>{`
        .mirror {
          transform: scaleX(-1);
        }
      `}</style>
    </div>
  );
}

function EffectOption({ label, isActive, onClick }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-transform hover:scale-105 ${isActive ? 'text-blue-400' : 'text-gray-300 hover:text-white'}`}
    >
      <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-xs font-semibold ${isActive ? 'bg-blue-600/20 border-2 border-blue-500' : 'bg-gray-800 border border-gray-600'}`}>
        ✨
      </div>
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
