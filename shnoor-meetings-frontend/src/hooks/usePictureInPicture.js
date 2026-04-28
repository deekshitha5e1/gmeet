import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * PIP_MODES Enum
 */
export const PIP_MODES = {
  NONE: 'none',
  VIDEO: 'video',      // Standard HTMLVideoElement.requestPictureInPicture
  DOCUMENT: 'document',   // documentPictureInPicture API
  FALLBACK: 'fallback', // Custom draggable in-page player (auto-fallback)
  MINIMIZED: 'minimized' // Explicitly minimized in-page player
};

/**
 * usePictureInPicture Hook
 * Manages the lifecycle and state of various Picture-in-Picture modes.
 */
export const usePictureInPicture = ({
  localStream,
  isVideoEnabled,
  isAudioEnabled,
  onToggleVideo,
  onToggleAudio,
  onLeaveCall
}) => {
  const [pipMode, setPipMode] = useState(PIP_MODES.NONE);
  const [pipWindow, setPipWindow] = useState(null);
  const [isPipEnabledByUser, setIsPipEnabledByUser] = useState(() => {
    return localStorage.getItem('shnoor_pip_enabled') === 'true';
  });

  const videoRef = useRef(null);

  const supportsVideoPip = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document;
  const supportsDocPip = typeof window !== 'undefined' && 'documentPictureInPicture' in window;

  const togglePipPreference = useCallback(() => {
    const newValue = !isPipEnabledByUser;
    setIsPipEnabledByUser(newValue);
    localStorage.setItem('shnoor_pip_enabled', newValue.toString());
  }, [isPipEnabledByUser]);

  const enterVideoPip = useCallback(async () => {
    if (!videoRef.current || !supportsVideoPip) return false;
    try {
      const videoElement = videoRef.current;
      if (videoElement.readyState < 2) return false;
      await videoElement.requestPictureInPicture();
      setPipMode(PIP_MODES.VIDEO);
      videoElement.addEventListener('leavepictureinpicture', () => {
        setPipMode(prev => prev === PIP_MODES.VIDEO ? PIP_MODES.NONE : prev);
      }, { once: true });
      return true;
    } catch (error) {
      console.error('Failed to enter Video PiP:', error);
      return false;
    }
  }, [supportsVideoPip]);

  const enterDocPip = useCallback(async () => {
    if (!supportsDocPip) return false;
    try {
      const win = await window.documentPictureInPicture.requestWindow({
        width: 380,
        height: 320,
      });
      setPipWindow(win);
      setPipMode(PIP_MODES.DOCUMENT);

      win.addEventListener('pagehide', () => {
        setPipWindow(null);
        setPipMode(prev => prev === PIP_MODES.DOCUMENT ? PIP_MODES.NONE : prev);
      });
      return true;
    } catch (error) {
      console.error('Failed to enter Document PiP:', error);
      return false;
    }
  }, [supportsDocPip]);

  const enterFallbackPip = useCallback(() => {
    setPipMode(PIP_MODES.FALLBACK);
    return true;
  }, []);

  const enterMinimized = useCallback(async () => {
    setPipMode(PIP_MODES.MINIMIZED);

    // Prioritize Document PiP to show custom controls (Mic, Cam, etc.)
    if (supportsDocPip) {
      const success = await enterDocPip();
      if (success) return;
    }

    // Fallback to Video PiP if Doc PiP fails or is unsupported
    if (videoRef.current && supportsVideoPip) {
      try {
        if (document.pictureInPictureElement !== videoRef.current) {
          await videoRef.current.requestPictureInPicture();
        }
      } catch (error) {
        console.warn('Browser Video PiP failed:', error);
      }
    }
  }, [supportsDocPip, supportsVideoPip, enterDocPip]);

  const exitPip = useCallback(async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }

      if (pipWindow) {
        pipWindow.close();
        setPipWindow(null);
      }
    } catch (error) {
      console.error('Error exiting PiP:', error);
    }
    setPipMode(PIP_MODES.NONE);
  }, [pipWindow]);

  const triggerPip = useCallback(async () => {
    // 1. Try Document PiP (Custom UI)
    if (supportsDocPip) {
      const success = await enterDocPip();
      if (success) return;
    }

    // 2. Try Video PiP (Standard)
    if (supportsVideoPip) {
      const success = await enterVideoPip();
      if (success) return;
    }

    // 3. Final fallback to in-app draggable
    enterFallbackPip();
  }, [supportsDocPip, supportsVideoPip, enterDocPip, enterVideoPip, enterFallbackPip]);

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (!isPipEnabledByUser || !localStream) return;
      if (document.visibilityState === 'hidden') {
        if (pipMode === PIP_MODES.NONE) {
          await triggerPip();
        }
      } else {
        if (pipMode !== PIP_MODES.NONE && pipMode !== PIP_MODES.MINIMIZED) {
          await exitPip();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isPipEnabledByUser, pipMode, localStream, triggerPip, exitPip]);

  useEffect(() => {
    return () => {
      if (pipWindow) pipWindow.close();
      if (typeof document !== 'undefined' && document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => { });
      }
    };
  }, [pipWindow]);

  return {
    pipMode,
    isPipEnabledByUser,
    togglePipPreference,
    videoRef,
    pipWindow,
    triggerPip,
    enterMinimized,
    exitPip,
    supportsAnyPip: supportsVideoPip || supportsDocPip
  };
};
