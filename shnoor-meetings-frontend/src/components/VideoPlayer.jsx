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
  isSharingScreen = false,
  audioLevel = 0,
  featured = false,
  compact = false,
}) => {
  const videoRef = useRef(null);
  const prevIsSharingRef = useRef(isSharingScreen);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const video = videoRef.current;
    const justStartedSharing = isSharingScreen && !prevIsSharingRef.current;
    prevIsSharingRef.current = isSharingScreen;

    const shouldPlay = isVideoEnabled || isSharingScreen;

    if (video && stream && shouldPlay) {
      if (video.srcObject !== stream || justStartedSharing) {
        video.srcObject = null;
        video.srcObject = stream;
      }
      video.play().then(() => { if (isMounted) setIsLoaded(true); })
        .catch(err => { if (err.name !== 'AbortError') console.warn('Video play failed', err); });
    }

    return () => { isMounted = false; };
  }, [stream, isVideoEnabled, isSharingScreen]);

  // When screen sharing: show video as soon as stream exists (track frames arrive via replaceTrack)
  // When camera: require a live video track
  const showVideo = isSharingScreen
    ? !!stream
    : isVideoEnabled && !!stream && stream.getVideoTracks().some(t => t.readyState === 'live');

  return (
    <div className={`relative overflow-hidden border group flex items-center justify-center transition-all duration-300 w-full aspect-video rounded-2xl bg-gray-800 ${
      isSpeaking ? 'border-white shadow-[0_0_20px_rgba(255,255,255,0.2)]' : 'border-gray-700/50'
    }`}>
      
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`w-full h-full ${
            (featured || isSharingScreen) ? 'object-contain' : 'object-cover'
          } ${
            (isLocal && !isSharingScreen) ? 'transform -scale-x-100' : ''
          }`}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
          <div className="relative flex items-center justify-center">
            {/* Pulsing Voice Circle */}
            {isSpeaking && isAudioEnabled && (
              <div 
                className="absolute rounded-full border-2 border-white/60 bg-white/5 transition-transform duration-75 ease-out"
                style={{ 
                  width: '130%', 
                  height: '130%', 
                  transform: `scale(${1 + (audioLevel * 1.8)})`,
                  opacity: 0.3 + (audioLevel * 0.7)
                }}
              />
            )}
            <ProfileAvatar
              name={label}
              picture={picture}
              className="h-20 w-20 md:h-24 md:w-24"
            />
          </div>
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
