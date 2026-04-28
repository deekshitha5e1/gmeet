import { useEffect, useMemo, useRef, useState } from 'react';

const LEVEL_THRESHOLD = 0.04;
const SPEAKING_HANG_MS = 420;
const DOMINANT_HOLD_MS = 650;
const TICK_MS = 160;

function getStatsLevel(reports) {
  let maxLevel = 0;

  reports.forEach((report) => {
    if (typeof report.audioLevel === 'number') {
      maxLevel = Math.max(maxLevel, report.audioLevel);
    }

    if (typeof report.totalAudioEnergy === 'number' && typeof report.totalSamplesDuration === 'number' && report.totalSamplesDuration > 0) {
      const normalized = Math.min(report.totalAudioEnergy / report.totalSamplesDuration, 1);
      maxLevel = Math.max(maxLevel, normalized);
    }
  });

  return maxLevel;
}

export default function useActiveSpeaker(tiles, getPeerConnection) {
  const [state, setState] = useState({
    dominantSpeakerId: null,
    speakingIds: [],
    audioLevels: {},
  });
  const refs = useRef({
    lastSpokeAt: {},
    dominantSpeakerId: null,
    dominantSince: 0,
    smoothedLevels: {},
  });

  const monitoredTiles = useMemo(
    () => tiles.filter((tile) => tile?.id && tile?.stream),
    [tiles]
  );

  useEffect(() => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !monitoredTiles.length) {
      setState({ dominantSpeakerId: null, speakingIds: [], audioLevels: {} });
      refs.current = {
        lastSpokeAt: {},
        dominantSpeakerId: null,
        dominantSince: 0,
        smoothedLevels: {},
      };
      return undefined;
    }

    const audioContext = new AudioContextClass();
    const analysers = new Map();
    const buffers = new Map();

    monitoredTiles.forEach((tile) => {
      const audioTracks = tile.stream?.getAudioTracks?.() || [];
      if (!audioTracks.length) {
        return;
      }

      try {
        const source = audioContext.createMediaStreamSource(new MediaStream(audioTracks));
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.82;
        source.connect(analyser);
        analysers.set(tile.id, { analyser, source });
        buffers.set(tile.id, new Uint8Array(analyser.frequencyBinCount));
      } catch (error) {
        console.warn('Unable to initialize active speaker monitoring for', tile.id, error);
      }
    });

    let isCancelled = false;

    const tick = async () => {
      const now = Date.now();
      const levels = {};

      await Promise.all(monitoredTiles.map(async (tile) => {
        if (tile.isAudioEnabled === false) {
          levels[tile.id] = 0;
          return;
        }

        const analyserEntry = analysers.get(tile.id);
        let analyserLevel = 0;

        if (analyserEntry) {
          const buffer = buffers.get(tile.id);
          analyserEntry.analyser.getByteFrequencyData(buffer);
          const total = buffer.reduce((sum, value) => sum + value, 0);
          analyserLevel = total / (buffer.length * 255);
        }

        let statsLevel = 0;
        if (!tile.isLocal) {
          const peerConnection = getPeerConnection?.(tile.id);
          if (peerConnection?.getStats) {
            try {
              const reports = await peerConnection.getStats();
              statsLevel = getStatsLevel(reports);
            } catch (error) {
              console.warn('Unable to read audio stats for', tile.id, error);
            }
          }
        }

        const rawLevel = Math.max(analyserLevel, statsLevel);
        const previousSmoothed = refs.current.smoothedLevels[tile.id] || 0;
        const smoothedLevel = (previousSmoothed * 0.58) + (rawLevel * 0.42);
        refs.current.smoothedLevels[tile.id] = smoothedLevel;
        levels[tile.id] = smoothedLevel;

        if (smoothedLevel > LEVEL_THRESHOLD) {
          refs.current.lastSpokeAt[tile.id] = now;
        }
      }));

      const speakingIds = monitoredTiles
        .filter((tile) => {
          const lastSpokeAt = refs.current.lastSpokeAt[tile.id] || 0;
          return levels[tile.id] > LEVEL_THRESHOLD || (now - lastSpokeAt) < SPEAKING_HANG_MS;
        })
        .sort((left, right) => (levels[right.id] || 0) - (levels[left.id] || 0))
        .map((tile) => tile.id);

      const topSpeakerId = speakingIds[0] || null;
      let nextDominantSpeakerId = refs.current.dominantSpeakerId;

      if (!topSpeakerId) {
        if ((now - refs.current.dominantSince) > DOMINANT_HOLD_MS) {
          nextDominantSpeakerId = null;
        }
      } else if (nextDominantSpeakerId === topSpeakerId) {
        refs.current.dominantSince = now;
      } else {
        const currentLevel = levels[nextDominantSpeakerId] || 0;
        const candidateLevel = levels[topSpeakerId] || 0;
        const shouldSwitch = !nextDominantSpeakerId
          || candidateLevel > (currentLevel * 1.18)
          || (now - refs.current.dominantSince) > DOMINANT_HOLD_MS;

        if (shouldSwitch) {
          nextDominantSpeakerId = topSpeakerId;
          refs.current.dominantSince = now;
        }
      }

      refs.current.dominantSpeakerId = nextDominantSpeakerId;

      if (!isCancelled) {
        setState((current) => {
          const sameDominant = current.dominantSpeakerId === nextDominantSpeakerId;
          const sameSpeakingIds = current.speakingIds.length === speakingIds.length
            && current.speakingIds.every((id, index) => id === speakingIds[index]);

          if (sameDominant && sameSpeakingIds) {
            return { ...current, audioLevels: levels };
          }

          return {
            dominantSpeakerId: nextDominantSpeakerId,
            speakingIds,
            audioLevels: levels,
          };
        });
      }
    };

    audioContext.resume().catch(() => {});
    tick();
    const intervalId = window.setInterval(tick, TICK_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      analysers.forEach(({ source }) => source.disconnect());
      audioContext.close().catch(() => {});
    };
  }, [getPeerConnection, monitoredTiles]);

  return {
    dominantSpeakerId: state.dominantSpeakerId,
    speakingIds: new Set(state.speakingIds),
    audioLevels: state.audioLevels,
  };
}
