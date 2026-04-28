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
    const remoteTiles = Object.entries(remoteStreams).map(([peerId, stream]) => ({
      id: peerId,
      stream,
      label: participantsMetadata[peerId]?.name || 'Participant',
      picture: participantsMetadata[peerId]?.picture,
      isHost: participantsMetadata[peerId]?.role === 'host',
      isLocal: false,
      isHandRaised: participantsMetadata[peerId]?.isHandRaised,
      isAudioEnabled: participantsMetadata[peerId]?.isAudioEnabled ?? true,
      isVideoEnabled: participantsMetadata[peerId]?.isVideoEnabled ?? true,
    }));

    const localTile = {
      id: localClientId,
      stream: localStream,
      label: displayName + ' (You)',
      isHost: participantsMetadata[localClientId]?.role === 'host',
      isLocal: true,
      isHandRaised,
      isAudioEnabled,
      isVideoEnabled,
    };

    return [localTile, ...remoteTiles];
  }, [remoteStreams, participantsMetadata, localClientId, localStream, displayName, isHandRaised, isAudioEnabled, isVideoEnabled]);

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
    <div className="w-full h-full flex items-center justify-center p-4">
      <div className={`grid gap-4 w-full ${gridClass} mx-auto items-center`}>
        {tiles.map((tile) => (
          <VideoPlayer
            key={tile.id}
            {...tile}
            isSpeaking={speakingIds.has(tile.id)}
            featured={tile.id === dominantSpeakerId}
          />
        ))}
      </div>
    </div>
  );
});

VideoGrid.displayName = 'VideoGrid';
export default VideoGrid;
