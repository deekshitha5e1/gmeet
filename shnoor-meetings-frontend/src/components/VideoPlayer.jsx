import React, { useEffect, useRef, useState } from 'react';
import { MicOff } from 'lucide-react';
import ProfileAvatar from './ProfileAvatar';

const VideoPlayer = React.memo(({
  stream,
  label,
  avatarName,
  picture,
  isHost = false,
  isLocal = false,
  isHandRaised = false,
  isSpeaking = false,
  isVideoEnabled = true,
  isAudioEnabled = true,
  isSharingScreen = false,
  hasRemoteVideoTrack = false,
  audioLevel = 0,
  featured = false,
  compact = false,
}) => {
  const videoRef = useRef(null);
  const prevIsSharingRef = useRef(isSharingScreen);
  const [hasRenderableFrame, setHasRenderableFrame] = useState(false);
  const [hasVisibleVideoFrame, setHasVisibleVideoFrame] = useState(false);
  const [trackStateVersion, setTrackStateVersion] = useState(0);

  useEffect(() => {
    let isMounted = true;
    let frameCheckId = null;
    let frameRequestId = null;
    let blackFrameCount = 0;
    const video = videoRef.current;
    const justStartedSharing = isSharingScreen && !prevIsSharingRef.current;
    prevIsSharingRef.current = isSharingScreen;

    const hasLiveAudioTrack = !!stream?.getAudioTracks?.().some(t => t.readyState === 'live');
    const shouldPlay = isAudioEnabled || isVideoEnabled || isSharingScreen || hasLiveAudioTrack;
    setHasRenderableFrame(false);
    setHasVisibleVideoFrame(false);

    if (video && stream && shouldPlay) {
      const canvas = document.createElement('canvas');
      canvas.width = 24;
      canvas.height = 24;
      const context = canvas.getContext('2d', { willReadFrequently: true });

      const updateVisibleFrameState = () => {
        if (!context || isSharingScreen || video.videoWidth === 0 || video.videoHeight === 0) {
          setHasVisibleVideoFrame(isSharingScreen);
          return;
        }

        try {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let totalBrightness = 0;

          for (let index = 0; index < pixels.length; index += 4) {
            totalBrightness += pixels[index] + pixels[index + 1] + pixels[index + 2];
          }

          const averageBrightness = totalBrightness / (pixels.length / 4) / 3;
          if (averageBrightness < 8) {
            blackFrameCount += 1;
          } else {
            blackFrameCount = 0;
          }

          setHasVisibleVideoFrame(blackFrameCount < 3);
        } catch {
          setHasVisibleVideoFrame(true);
        }
      };

      const updateRenderableState = () => {
        if (!isMounted) return;
        setHasRenderableFrame(video.videoWidth > 0 && video.videoHeight > 0);
        updateVisibleFrameState();
      };

      const scheduleFrameCheck = () => {
        if (!isMounted) return;
        updateRenderableState();
        if (video.videoWidth > 0 && video.videoHeight > 0) return;

        if (typeof video.requestVideoFrameCallback === 'function') {
          frameRequestId = video.requestVideoFrameCallback(scheduleFrameCheck);
        } else {
          frameCheckId = window.setTimeout(scheduleFrameCheck, 250);
        }
      };

      if (video.srcObject !== stream || justStartedSharing) {
        video.srcObject = null;
        video.srcObject = stream;
      }
      video.addEventListener('loadedmetadata', updateRenderableState);
      video.addEventListener('playing', updateRenderableState);
      video.addEventListener('resize', updateRenderableState);
      updateRenderableState();
      video.play().then(scheduleFrameCheck)
        .catch(err => { if (err.name !== 'AbortError') console.warn('Video play failed', err); });
      scheduleFrameCheck();

      return () => {
        isMounted = false;
        if (frameCheckId) window.clearTimeout(frameCheckId);
        if (frameRequestId && typeof video.cancelVideoFrameCallback === 'function') {
          video.cancelVideoFrameCallback(frameRequestId);
        }
        video.removeEventListener('loadedmetadata', updateRenderableState);
        video.removeEventListener('playing', updateRenderableState);
        video.removeEventListener('resize', updateRenderableState);
      };
    }

    return () => { isMounted = false; };
  }, [stream, isAudioEnabled, isVideoEnabled, isSharingScreen]);

  useEffect(() => {
    if (!stream) return undefined;

    const tracks = stream.getTracks();
    const refreshTrackState = () => setTrackStateVersion((version) => version + 1);

    tracks.forEach((track) => {
      track.addEventListener('mute', refreshTrackState);
      track.addEventListener('unmute', refreshTrackState);
      track.addEventListener('ended', refreshTrackState);
    });

    refreshTrackState();

    return () => {
      tracks.forEach((track) => {
        track.removeEventListener('mute', refreshTrackState);
        track.removeEventListener('unmute', refreshTrackState);
        track.removeEventListener('ended', refreshTrackState);
      });
    };
  }, [stream]);

  // When screen sharing: show video as soon as stream exists (track frames arrive via replaceTrack)
  // When camera: require a live video track
  // Keep the media element mounted for audio-only participants, but visually show the avatar.
  void trackStateVersion;
  const hasPlayableAudio = isAudioEnabled && !!stream && stream.getAudioTracks().some(t => t.readyState === 'live' && t.enabled);
  const hasLiveVideo = !!stream && stream.getVideoTracks().some(t => t.readyState === 'live' && t.enabled);
  const shouldAttemptVideo = isSharingScreen
    ? !!stream
    : isVideoEnabled && (hasLiveVideo || hasRemoteVideoTrack);
  const showVideo = shouldAttemptVideo && hasRenderableFrame;
  const shouldShowVideo = showVideo && (isSharingScreen || hasVisibleVideoFrame);
  const shouldRenderMediaElement = shouldAttemptVideo || hasPlayableAudio;

  return (
    <div className={`relative overflow-hidden border group flex items-center justify-center transition-all duration-300 w-full aspect-video rounded-2xl bg-gray-800 ${
      isSpeaking ? 'border-white shadow-[0_0_20px_rgba(255,255,255,0.2)]' : 'border-gray-700/50'
    }`}>
      
      <div className={`absolute inset-0 z-10 flex items-center justify-center bg-gray-900 transition-opacity duration-200 ${
        shouldShowVideo ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}>
        <div className="relative flex items-center justify-center">
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
            name={avatarName || label}
            picture={picture}
            className="h-20 w-20 md:h-24 md:w-24"
          />
        </div>
      </div>

      {shouldRenderMediaElement && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`absolute inset-0 z-0 w-full h-full transition-opacity duration-200 ${
            (featured || isSharingScreen) ? 'object-contain' : 'object-cover'
          } ${
            (isLocal && !isSharingScreen) ? 'transform -scale-x-100' : ''
          } ${shouldShowVideo ? 'opacity-100' : 'opacity-0'}`}
        />
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
