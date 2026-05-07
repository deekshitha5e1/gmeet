import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWebRTC } from '../hooks/useWebRTC';
import { usePictureInPicture, PIP_MODES } from '../hooks/usePictureInPicture';
import VideoGrid from '../components/VideoGrid';
import MeetingControls from '../components/MeetingControls';
import ChatPanel from '../components/ChatPanel';
import ParticipantsList from '../components/ParticipantsList';
import PipPopup from '../components/PipPopup';
import InPagePip from '../components/InPagePip';
import { Video, Maximize2, Copy, Check, UserPlus, X, Mail, Loader2 } from 'lucide-react';
import { getCurrentUser } from '../utils/currentUser';
import { buildApiUrl } from '../utils/api';

const MeetingRoom = () => {
  const { id: roomId } = useParams();
  const navigate = useNavigate();
  const [activePanel, setActivePanel] = useState(null); // 'chat' | 'people' | null
  const [isCaptionsOn, setIsCaptionsOn] = useState(false);
  const [captions, setCaptions] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [showAddUsers, setShowAddUsers] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteStatus, setInviteStatus] = useState({ type: '', message: '' });
  const [isSendingInvite, setIsSendingInvite] = useState(false);

  // The shareable invite link always goes through the lobby so role detection works.
  const meetingUrl = `${window.location.origin}/meeting/${roomId}`;

  // Role detection for initial hook state
  const currentUser = useMemo(() => getCurrentUser(), []);
  const params = new URLSearchParams(window.location.search);
  const emailFromUrl = params.get('email')?.toLowerCase();
  
  const myEmail = (emailFromUrl || sessionStorage.getItem(`meeting_email_${roomId}`) || currentUser?.email || '').trim().toLowerCase();
  const myId = currentUser?.meetingUserId;
  const storedHostEmail = (localStorage.getItem(`meeting_host_${roomId}`) || '').trim().toLowerCase();
  const storedRole = sessionStorage.getItem(`meeting_role_${roomId}`);

  const iAmHost =
    storedRole === 'host' ||
    (myEmail && storedHostEmail && myEmail === storedHostEmail) ||
    (myId && storedHostEmail === `id:${myId}`);

  // WebRTC Hook - Optimized Return
  const {
    localStream,
    remoteStreams,
    messages,
    participantsMetadata,
    isSharingScreen,
    isHandRaised,
    isAudioEnabled,
    isVideoEnabled,
    toggleVideo,
    toggleAudio,
    toggleScreenShare,
    toggleRaiseHand,
    sendChatMessage,
    admitParticipant,
    denyParticipant,
    activeJoinRequests,
    isHost,
    mediaError,
    localClientId,
    getPeerConnection,
    displayName: meetingDisplayName,
    cameraStream
  } = useWebRTC(roomId, { initialRole: iAmHost ? 'host' : 'participant' });

  // ── Admission guard ──────────────────────────────────────────────────────────
  // If someone navigates directly to /room/:id without going through the lobby
  // (i.e. not admitted and not the host), send them back to the lobby.
  useEffect(() => {
    const admitted = sessionStorage.getItem(`meeting_admitted_${roomId}`) === 'true';
    if (!admitted && !iAmHost) {
      navigate(`/meeting/${roomId}`, { replace: true });
    }
  }, [roomId, navigate, iAmHost]);

  // Picture-in-Picture Hook
  const {
    pipMode,
    isPipEnabledByUser,
    togglePipPreference,
    exitPip,
    enterMinimized,
    pipWindow,
  } = usePictureInPicture({
    localStream,
    isVideoEnabled,
    isAudioEnabled,
    onToggleVideo: toggleVideo,
    onToggleAudio: toggleAudio,
    onLeaveCall: () => navigate(`/left-meeting/${roomId}`)
  });

  // Stable Handlers
  const handleToggleChat = useCallback(() => setActivePanel(p => p === 'chat' ? null : 'chat'), []);
  const handleTogglePeople = useCallback(() => setActivePanel(p => p === 'people' ? null : 'people'), []);
  const handleLeave = useCallback(() => navigate(`/left-meeting/${roomId}`), [navigate, roomId]);

  const handleAdmit = useCallback((id) => admitParticipant(id), [admitParticipant]);
  const handleDeny = useCallback((id) => denyParticipant(id), [denyParticipant]);

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(meetingUrl);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }, [meetingUrl]);

  const handleSendInvite = useCallback(async (event) => {
    event.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      setInviteStatus({ type: 'error', message: 'Enter an email address.' });
      return;
    }

    setIsSendingInvite(true);
    setInviteStatus({ type: '', message: '' });
    try {
      const response = await fetch(buildApiUrl(`/api/meetings/${roomId}/invite-user`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          host_name: currentUser?.name || 'Host',
          host_email: currentUser?.email || sessionStorage.getItem(`meeting_email_${roomId}`) || '',
          frontend_origin: window.location.origin,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to send invite.');
      }
      setInviteStatus({ type: 'success', message: `Invite sent to ${email}.` });
      setInviteEmail('');
    } catch (error) {
      setInviteStatus({ type: 'error', message: error.message || 'Failed to send invite.' });
    } finally {
      setIsSendingInvite(false);
    }
  }, [currentUser?.email, currentUser?.name, inviteEmail, roomId]);

  // Captions Logic - Optimized to avoid render blocking
  useEffect(() => {
    if (!isCaptionsOn) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (e) => {
      const text = Array.from(e.results).map(r => r[0].transcript).join('');
      setCaptions(text);
    };
    recognition.start();
    return () => recognition.stop();
  }, [isCaptionsOn]);

  return (
    <div className="h-screen w-full bg-gray-950 flex flex-col overflow-hidden text-white font-sans">
      {/* Header - Hidden when minimized if you want a cleaner look, but kept for context here */}
      <header className={`p-4 flex items-center justify-between border-b border-gray-800/50 bg-gray-900/50 backdrop-blur-xl z-20 transition-all duration-500 ${pipMode === PIP_MODES.MINIMIZED ? 'opacity-0 -translate-y-full' : ''}`}>
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 bg-red-500 rounded-full animate-pulse" />
          <span className="font-bold tracking-tight text-white/90">Shnoor Meetings</span>
          <div className="h-4 w-[1px] bg-white/10 mx-1" />
          
          <div className="hidden md:flex items-center gap-2 bg-white/5 hover:bg-white/10 transition-colors rounded-full pl-3 pr-1 py-1 border border-white/10 group">
             <span className="text-[11px] text-gray-400 font-medium tracking-wide truncate max-w-[150px] lg:max-w-xs">
               {meetingUrl.replace(/^https?:\/\//, '')}
             </span>
             <button 
               onClick={handleCopyLink}
               className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold transition-all transform active:scale-95 ${isCopied ? 'bg-green-500 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'}`}
               title="Copy meeting link"
             >
               {isCopied ? <Check size={12} /> : <Copy size={12} />}
               {isCopied ? 'COPIED' : 'COPY LINK'}
             </button>
          </div>

          <div className="md:hidden h-4 w-[1px] bg-gray-800 mx-2" />
          <span className="md:hidden text-xs text-gray-500 font-mono select-all cursor-pointer hover:text-gray-300">ID: {roomId}</span>
        </div>

        {isHost && (
          <button
            onClick={() => {
              setShowAddUsers(true);
              setInviteStatus({ type: '', message: '' });
            }}
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-950/20 transition hover:bg-blue-500 active:scale-95"
          >
            <UserPlus size={16} />
            Add users
          </button>
        )}
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        {/* Minimized Placeholder */}
        {pipMode === PIP_MODES.MINIMIZED && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/80 backdrop-blur-sm z-10 animate-in fade-in zoom-in duration-500">
            <div className="p-8 rounded-full bg-blue-600/10 border border-blue-500/20 mb-6">
              <Maximize2 size={48} className="text-blue-500 animate-pulse" />
            </div>
            <h2 className="text-xl font-bold mb-2">Meeting Minimized</h2>
            <p className="text-gray-400 text-sm mb-8">The meeting is running in a floating window.</p>
            <button
              onClick={exitPip}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-bold shadow-xl transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2"
            >
              <Maximize2 size={18} />
              Restore Meeting
            </button>
          </div>
        )}

        <div className={`flex-1 flex flex-col relative min-w-0 transition-opacity duration-500 ${pipMode === PIP_MODES.MINIMIZED ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <VideoGrid
            localStream={localStream}
            remoteStreams={remoteStreams}
            participantsMetadata={participantsMetadata}
            localClientId={localClientId}
            isAudioEnabled={isAudioEnabled}
            isVideoEnabled={isVideoEnabled}
            isHandRaised={isHandRaised}
            isSharingScreen={isSharingScreen}
            displayName={meetingDisplayName || currentUser?.name || 'Me'}
            getPeerConnection={getPeerConnection}
          />

          {/* Media error modal removed as per user request to improve experience */}
          {isCaptionsOn && captions && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur px-6 py-3 rounded-2xl text-center max-w-2xl shadow-2xl border border-white/5 animate-in fade-in slide-in-from-bottom-4">
              <p className="text-sm font-medium leading-relaxed">{captions}</p>
            </div>
          )}

        </div>

        {activePanel === 'chat' && pipMode !== PIP_MODES.MINIMIZED && (
          <ChatPanel 
            messages={messages} 
            onSendMessage={sendChatMessage} 
            onClose={() => setActivePanel(null)} 
          />
        )}
        
        {activePanel === 'people' && pipMode !== PIP_MODES.MINIMIZED && (
          <ParticipantsList 
            participants={participantsMetadata}
            joinRequests={activeJoinRequests}
            isHost={isHost}
            onAdmit={handleAdmit}
            onDeny={handleDeny}
            onClose={() => setActivePanel(null)}
          />
        )}

        {/* Floating join-request banner – visible even when People panel is closed */}
        {isHost && activeJoinRequests.length > 0 && activePanel !== 'people' && pipMode !== PIP_MODES.MINIMIZED && (
          <div className="absolute top-16 md:top-4 right-2 md:right-4 z-30 flex flex-col gap-2 w-[calc(100%-1rem)] md:max-w-xs animate-in slide-in-from-top-4 duration-300">
            {activeJoinRequests.map(req => (
              <div
                key={req.id}
                className="flex items-center gap-3 bg-gray-800/95 backdrop-blur border border-gray-700 rounded-2xl px-4 py-3 shadow-2xl"
              >
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {req.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{req.name}</p>
                  <p className="text-xs text-gray-400">wants to join</p>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => handleAdmit(req.id)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-colors"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleDeny(req.id)}
                    className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white rounded-lg text-xs font-semibold transition-colors"
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className={`border-t border-gray-800/50 bg-gray-900/80 backdrop-blur-xl z-20 transition-all duration-500 ${pipMode === PIP_MODES.MINIMIZED ? 'opacity-0 translate-y-full' : ''}`}>
        <MeetingControls
          isAudioOn={isAudioEnabled}
          isVideoOn={isVideoEnabled}
          isHandRaised={isHandRaised}
          isSharingScreen={isSharingScreen}
          isCaptionsOn={isCaptionsOn}
          isPipEnabled={isPipEnabledByUser}
          joinRequestCount={activeJoinRequests.length}
          onToggleAudio={toggleAudio}
          onToggleVideo={toggleVideo}
          onToggleRaiseHand={toggleRaiseHand}
          onToggleCaptions={() => setIsCaptionsOn(!isCaptionsOn)}
          onMinimize={enterMinimized}
          onTogglePip={togglePipPreference}
          onLeave={handleLeave}
          onToggleChat={handleToggleChat}
          onTogglePeople={handleTogglePeople}
          onToggleScreenShare={toggleScreenShare}
        />
      </footer>

      {/* Floating Picture-in-Picture Mini Player */}
      {pipMode === PIP_MODES.DOCUMENT && pipWindow && (
        <PipPopup pipWindow={pipWindow}>
          <InPagePip
            localStream={localStream}
            cameraStream={cameraStream}
            isVideoEnabled={isVideoEnabled}
            isAudioEnabled={isAudioEnabled}
            isSharingScreen={isSharingScreen}
            onToggleVideo={toggleVideo}
            onToggleAudio={toggleAudio}
            onLeaveCall={handleLeave}
            onMaximize={exitPip}
            inPortal={true}
          />
        </PipPopup>
      )}

      {(pipMode === PIP_MODES.FALLBACK || pipMode === PIP_MODES.MINIMIZED) && (
        <InPagePip
          localStream={localStream}
          cameraStream={cameraStream}
          isVideoEnabled={isVideoEnabled}
          isAudioEnabled={isAudioEnabled}
          isSharingScreen={isSharingScreen}
          onToggleVideo={toggleVideo}
          onToggleAudio={toggleAudio}
          onLeaveCall={handleLeave}
          onMaximize={exitPip}
        />
      )}

      {showAddUsers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-6 text-white shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold">Add users</h2>
                <p className="mt-1 text-sm text-gray-400">Send an invite link to join through the waiting room.</p>
              </div>
              <button
                onClick={() => setShowAddUsers(false)}
                className="rounded-full p-2 text-gray-400 transition hover:bg-gray-800 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSendInvite} className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-300">Email address</span>
                <div className="flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 focus-within:border-blue-500">
                  <Mail size={16} className="text-gray-500" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="person@example.com"
                    className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
                    autoFocus
                  />
                </div>
              </label>

              {inviteStatus.message && (
                <div className={`rounded-xl px-3 py-2 text-sm ${
                  inviteStatus.type === 'success'
                    ? 'border border-green-500/30 bg-green-500/10 text-green-200'
                    : 'border border-red-500/30 bg-red-500/10 text-red-200'
                }`}>
                  {inviteStatus.message}
                </div>
              )}

              <button
                type="submit"
                disabled={isSendingInvite || !inviteEmail.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSendingInvite ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                {isSendingInvite ? 'Sending...' : 'Add'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingRoom;
