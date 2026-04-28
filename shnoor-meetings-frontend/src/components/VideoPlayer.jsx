import React, { useEffect, useRef, useState } from 'react';
import { MicOff } from 'lucide-react';
import ProfileAvatar from './ProfileAvatar';

const VideoPlayer = React.memo(({
  stream,
  label,
  picture,
  isHost = false,
  isLocal = false,
  isHandRaised = false,
  isSpeaking = false,
  isVideoEnabled = true,
  isAudioEnabled = true,
  featured = false,
  compact = false,
}) => {
  const videoRef = useRef(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const video = videoRef.current;
    
    if (video && stream && isVideoEnabled) {
      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }
      
      const playVideo = async () => {
        try {
          if (video.paused) {
            await video.play();
            if (isMounted) setIsLoaded(true);
          }
        } catch (err) {
          if (err.name !== 'AbortError') {
            console.warn('Video play failed', err);
          }
        }
      };
      playVideo();
    }

    return () => { isMounted = false; };
  }, [stream, isVideoEnabled]);

  return (
    <div className={`relative overflow-hidden border group flex items-center justify-center transition-all duration-300 ${
      featured ? 'w-full h-full rounded-3xl bg-black' : 'w-full aspect-video rounded-2xl bg-gray-800'
    } ${isSpeaking ? 'border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.3)]' : 'border-gray-700/50'}`}>
      
      {isVideoEnabled && stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full ${featured ? 'object-contain' : 'object-cover'} ${isLocal ? 'transform -scale-x-100' : ''}`}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
          <ProfileAvatar
            name={label}
            picture={picture}
            className={featured ? 'h-32 w-32' : 'h-16 w-16'}
          />
        </div>
      )}

      {/* Overlays - Optimized to be minimal */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 px-2 py-1 bg-black/50 backdrop-blur-md rounded-lg">
        <span className="text-xs font-medium text-white truncate max-w-[120px]">{label}</span>
        {isHost && <span className="text-[10px] bg-blue-600 px-1.5 py-0.5 rounded text-white">Host</span>}
      </div>

      {!isAudioEnabled && (
        <div className="absolute top-3 right-3 p-1.5 bg-red-500/80 rounded-full text-white">
          <MicOff size={14} />
        </div>
      )}

      {isHandRaised && (
        <div className="absolute top-3 left-3 bg-yellow-500 p-1.5 rounded-full shadow-lg">
          <span className="text-[10px] font-bold text-black">✋</span>
        </div>
      )}
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';

export default VideoPlayer;
