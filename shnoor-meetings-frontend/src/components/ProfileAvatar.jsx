import { useMemo, useState } from 'react';

function getDisplayInitial(name = 'P') {
  return `${name}`.trim().charAt(0).toUpperCase() || 'P';
}

function getAvatarPalette(seed = '') {
  const normalized = `${seed}`.trim().toLowerCase() || 'participant';
  let hash = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    hash = normalized.charCodeAt(index) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  const start = `hsl(${hue} 72% 56%)`;
  const end = `hsl(${(hue + 32) % 360} 68% 36%)`;
  return { start, end };
}

export default function ProfileAvatar({
  name,
  picture,
  className = 'h-10 w-10',
  textClass = 'text-sm',
  ringClassName = '',
  title,
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const normalizedPicture = `${picture || ''}`.trim();
  const shouldShowImage = Boolean(normalizedPicture && !imageFailed);
  const palette = useMemo(() => getAvatarPalette(name), [name]);

  return (
    <div
      className={`${className} overflow-hidden rounded-full text-white shadow-lg ${ringClassName}`}
      style={shouldShowImage ? undefined : {
        backgroundImage: `linear-gradient(135deg, ${palette.start}, ${palette.end})`,
      }}
      title={title || name || 'Participant'}
    >
      {shouldShowImage ? (
        <img
          src={normalizedPicture}
          alt={name || 'Participant'}
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className={`font-medium ${textClass}`}>{getDisplayInitial(name)}</span>
        </div>
      )}
    </div>
  );
}
