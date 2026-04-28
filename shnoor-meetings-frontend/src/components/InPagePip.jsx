import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Maximize2, GripHorizontal } from 'lucide-react';

/**
 * InPagePip Component
 * A draggable, floating mini-player that stays within the page.
 */
export default function InPagePip({
  localStream,
  isVideoEnabled,
  isAudioEnabled,
  onToggleVideo,
  onToggleAudio,
  onLeaveCall,
  onMaximize,
  inPortal = false
}) {
  const isSmallWindow = typeof window !== 'undefined' && window.innerWidth < 450;
  const useFullWindow = inPortal || isSmallWindow;

  const [position, setPosition] = useState({ 
    x: typeof window !== 'undefined' ? window.innerWidth - 340 : 20, 
    y: typeof window !== 'undefined' ? window.innerHeight - 240 : 20 
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const videoRef = useRef(null);

  // Bind stream to video element and handle play
  useEffect(() => {
    let isMounted = true;
    if (videoRef.current && localStream) {
      const element = videoRef.current;
      element.srcObject = localStream;
      
      const playVideo = async () => {
        try {
          if (element.paused) {
            await element.play();
          }
        } catch (error) {
          if (error.name !== 'AbortError') {
            console.warn('PiP Video play failed:', error);
          }
        }
      };
      
      playVideo();
    }
    return () => { isMounted = false; };
  }, [localStream, isVideoEnabled]);

  // Dragging logic - Only enable if NOT in a full-window portal
  const handleMouseDown = (e) => {
    if (useFullWindow) return;
    setIsDragging(true);
    dragStartPos.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  useEffect(() => {
    if (useFullWindow) return;

    const handleMouseMove = (e) => {
      if (!isDragging) return;

      const newX = Math.max(10, Math.min(window.innerWidth - 330, e.clientX - dragStartPos.current.x));
      const newY = Math.max(10, Math.min(window.innerHeight - 230, e.clientY - dragStartPos.current.y));

      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, useFullWindow]);

  const containerStyle = useFullWindow ? {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    borderRadius: '0'
  } : {
    position: 'fixed',
    left: position.x,
    top: position.y,
    width: '340px',
    height: '220px',
    cursor: isDragging ? 'grabbing' : 'auto'
  };

  return (
    <div
      className={`mini-controls z-[9999] bg-gray-950 shadow-2xl overflow-hidden border border-gray-800 select-none group transition-shadow duration-300 hover:shadow-blue-500/10 pointer-events-auto ${!useFullWindow ? 'rounded-3xl' : ''}`}
      style={containerStyle}
    >
      {/* Drag Handle Overlay - Only show if draggable */}
      {!useFullWindow && (
        <div
          onMouseDown={handleMouseDown}
          className="absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-black/80 to-transparent flex items-start justify-center pt-2 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity z-20"
        >
          <GripHorizontal className="text-white/40" size={24} />
        </div>
      )}

      {/* Video Content */}
      <div className="relative w-full h-full bg-black">
        {isVideoEnabled && localStream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover mirror"
            style={{ pointerEvents: 'none' }} // Disable right-click/controls
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-900">
            <div className="w-20 h-20 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
              <VideoOff className="text-gray-600" size={32} />
            </div>
          </div>
        )}

        {/* Meeting Controls Overlay - Styled like the user's image */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-4 z-10">
          <div className="flex justify-end">
            <button
              onClick={onMaximize}
              className="p-2 bg-gray-800/80 hover:bg-gray-700 rounded-full text-white transition-all transform hover:scale-110"
              title="Maximize"
            >
              <Maximize2 size={18} />
            </button>
          </div>

          <div className="flex items-center justify-center gap-4">
            <button
              onClick={onToggleAudio}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all transform hover:scale-110 ${isAudioEnabled ? 'bg-gray-700/90 hover:bg-gray-600' : 'bg-red-500/90 hover:bg-red-600 shadow-lg shadow-red-500/20'}`}
              title={isAudioEnabled ? "Mute Microphone" : "Unmute Microphone"}
            >
              {isAudioEnabled ? <Mic size={20} className="text-white" /> : <MicOff size={20} className="text-white" />}
            </button>
            <button
              onClick={onToggleVideo}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all transform hover:scale-110 ${isVideoEnabled ? 'bg-gray-700/90 hover:bg-gray-600' : 'bg-red-500/90 hover:bg-red-600 shadow-lg shadow-red-500/20'}`}
              title={isVideoEnabled ? "Turn off Camera" : "Turn on Camera"}
            >
              {isVideoEnabled ? <Video size={20} className="text-white" /> : <VideoOff size={20} className="text-white" />}
            </button>
            <button
              onClick={onLeaveCall}
              className="w-12 h-12 bg-red-600 hover:bg-red-500 rounded-full flex items-center justify-center transition-all transform hover:scale-110 shadow-lg shadow-red-600/30"
              title="Leave Meeting"
            >
              <PhoneOff size={20} className="text-white" />
            </button>
          </div>
        </div>
      </div>

      {/* Visual Indicator of Live Meeting */}
      <div className="absolute bottom-2 left-4 z-10 opacity-60 group-hover:opacity-0 transition-opacity pointer-events-none">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] font-bold text-white uppercase tracking-widest">Live</span>
        </div>
      </div>
    </div>
  );
}
