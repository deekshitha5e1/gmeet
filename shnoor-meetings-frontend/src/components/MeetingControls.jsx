import React from 'react';
import { Mic, MicOff, Video, VideoOff, MessageSquare, PhoneOff, Monitor, Hand, Users, Type, Minimize2, ExternalLink } from 'lucide-react';

const MeetingControls = React.memo(({
  onToggleVideo,
  onToggleAudio,
  onToggleRaiseHand,
  onToggleCaptions,
  onToggleChat,
  onTogglePeople,
  onToggleScreenShare,
  onMinimize,
  onTogglePip,
  onLeave,
  isAudioOn,
  isVideoOn,
  isHandRaised,
  isCaptionsOn,
  isSharingScreen,
  isPipEnabled,
  joinRequestCount = 0,
}) => {
  const btnBase = "p-4 rounded-full transition-all flex items-center justify-center transform hover:scale-110 shadow-lg active:scale-95";

  return (
    <div className="flex items-center justify-center gap-3 py-4 px-4 max-w-full overflow-x-auto">
      <button
        onClick={onToggleAudio}
        className={`${btnBase} ${isAudioOn ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-red-500 text-white hover:bg-red-600'}`}
        title={isAudioOn ? "Mute" : "Unmute"}
      >
        {isAudioOn ? <Mic size={20} /> : <MicOff size={20} />}
      </button>

      <button
        onClick={onToggleVideo}
        className={`${btnBase} ${isVideoOn ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-red-500 text-white hover:bg-red-600'}`}
        title={isVideoOn ? "Stop Video" : "Start Video"}
      >
        {isVideoOn ? <Video size={20} /> : <VideoOff size={20} />}
      </button>

      <button
        onClick={onToggleRaiseHand}
        className={`${btnBase} ${isHandRaised ? 'bg-yellow-500 text-white' : 'bg-gray-800 text-white hover:bg-gray-700'}`}
        title="Raise Hand"
      >
        <Hand size={20} />
      </button>

      <button
        onClick={onToggleCaptions}
        className={`${btnBase} ${isCaptionsOn ? 'bg-blue-600 text-white' : 'bg-gray-800 text-white hover:bg-gray-700'}`}
        title="Toggle Captions"
      >
        <Type size={20} />
      </button>

      <div className="w-[1px] h-8 bg-gray-800 mx-2 hidden sm:block" />

      {/* New Minimize Option */}
      <button
        onClick={onMinimize}
        className={`${btnBase} bg-blue-600 text-white hover:bg-blue-500`}
        title="Minimize Meeting"
      >
        <Minimize2 size={20} />
      </button>

      {/* PiP Preference Toggle */}
      <button
        onClick={onTogglePip}
        className={`${btnBase} ${isPipEnabled ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-white hover:bg-gray-700'}`}
        title={isPipEnabled ? "Disable Auto-PiP" : "Enable Auto-PiP"}
      >
        <ExternalLink size={20} />
      </button>

      {onToggleScreenShare && (
        <button
          onClick={onToggleScreenShare}
          className={`${btnBase} ${isSharingScreen ? 'bg-green-600 text-white hover:bg-green-500' : 'bg-gray-800 text-white hover:bg-gray-700'}`}
          title={isSharingScreen ? 'Stop Sharing' : 'Share Screen'}
        >
          <Monitor size={20} />
        </button>
      )}

      <button
        onClick={onToggleChat}
        className={`${btnBase} bg-gray-800 text-white hover:bg-gray-700`}
        title="Chat"
      >
        <MessageSquare size={20} />
      </button>

      <button
        onClick={onTogglePeople}
        className={`relative ${btnBase} bg-gray-800 text-white hover:bg-gray-700`}
        title="Participants"
      >
        <Users size={20} />
        {joinRequestCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-gray-900 animate-pulse">
            {joinRequestCount}
          </span>
        )}
      </button>

      <button
        onClick={onLeave}
        className="p-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl flex items-center gap-2 font-bold px-6 ml-2 transition-colors"
      >
        <PhoneOff size={20} />
        <span className="hidden md:inline text-sm uppercase tracking-wider">Leave</span>
      </button>
    </div>
  );
});

MeetingControls.displayName = 'MeetingControls';
export default MeetingControls;
