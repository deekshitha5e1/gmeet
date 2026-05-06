import React, { useMemo } from 'react';
import VideoPlayer from './VideoPlayer';
import useActiveSpeaker from '../hooks/useActiveSpeaker';

const VideoGrid = React.memo(({
  localStream,
  remoteStreams,
  participantsMetadata,
  localClientId,
  isAudioEnabled,
  isVideoEnabled,
  isHandRaised,
  isSharingScreen,
  displayName,
  getPeerConnection
}) => {
  
  // Transform data into a stable format for the grid
  const tiles = useMemo(() => {
    // 1. Get all remote participants from metadata
    const remoteTiles = Object.entries(participantsMetadata)
      .filter(([id]) => id !== localClientId) // Exclude local user
      .map(([peerId, meta]) => ({
        id: peerId,
        stream: remoteStreams[peerId] || null,
        label: meta.name || 'Participant',
        picture: meta.picture,
        isHost: meta.role === 'host',
        isLocal: false,
        isHandRaised: meta.isHandRaised,
        isAudioEnabled: meta.isAudioEnabled ?? true,
        isVideoEnabled: meta.isVideoEnabled ?? true,
        isSharingScreen: meta.isSharingScreen ?? false,
      }));

    // 2. Add the local user tile
    const localTile = {
      id: localClientId,
      stream: localStream,
      label: displayName + ' (You)',
      picture: participantsMetadata[localClientId]?.picture,
      isHost: participantsMetadata[localClientId]?.role === 'host',
      isLocal: true,
      isHandRaised,
      isAudioEnabled,
      isVideoEnabled,
      isSharingScreen,
    };

    return [localTile, ...remoteTiles];
  }, [participantsMetadata, localClientId, localStream, remoteStreams, displayName, isHandRaised, isAudioEnabled, isVideoEnabled, isSharingScreen]);

  // Optimized Speaker Detection
  const { dominantSpeakerId, speakingIds, audioLevels } = useActiveSpeaker(tiles, getPeerConnection);

  // Layout Logic
  const gridClass = useMemo(() => {
    const count = tiles.length;
    if (count <= 1) return 'grid-cols-1 max-w-4xl';
    if (count <= 2) return 'grid-cols-1 md:grid-cols-2 max-w-6xl';
    if (count <= 4) return 'grid-cols-2 max-w-6xl';
    return 'grid-cols-2 lg:grid-cols-3 max-w-7xl';
  }, [tiles.length]);

  return (
    <div className="w-full h-full flex items-center justify-center p-4 overflow-y-auto">
      <div className={`grid gap-4 w-full ${gridClass} mx-auto items-center`}>
        {tiles.map((tile) => (
          <VideoPlayer
            key={tile.id}
            {...tile}
            isSpeaking={speakingIds.has(tile.id)}
            audioLevel={audioLevels[tile.id] || 0}
            featured={tile.id === dominantSpeakerId}
          />
        ))}
      </div>
    </div>
  );
});

VideoGrid.displayName = 'VideoGrid';
export default VideoGrid;
