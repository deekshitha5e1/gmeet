export default function SpeakerHighlight({
  active = false,
  featured = false,
  pulseTarget = 'tile',
  children,
}) {
  const pulseClass = active
    ? pulseTarget === 'avatar'
      ? 'animate-[speakerAvatarPulse_1.15s_ease-in-out_infinite]'
      : 'animate-[speakerTilePulse_1.15s_ease-in-out_infinite]'
    : '';

  return (
    <div className={`relative ${pulseClass}`}>
      {active && (
        <>
          <div
            className={`pointer-events-none absolute inset-0 rounded-[inherit] border border-emerald-300/80 shadow-[0_0_0_1px_rgba(110,231,183,0.65),0_0_36px_rgba(52,211,153,0.35)] ${
              featured ? 'animate-[speakerRing_1.2s_ease-in-out_infinite]' : 'animate-[speakerRing_1.35s_ease-in-out_infinite]'
            }`}
          />
          <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-emerald-300/8" />
        </>
      )}
      {children}
    </div>
  );
}
