export function VibeCheckLogo({ className = "w-11 h-11" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
    >
      {/* Circular Retro Badge */}
      <circle
        cx="24"
        cy="24"
        r="21"
        fill="#FFD60A"
        stroke="#111111"
        strokeWidth="3.2"
      />
      {/* Camera Shutter Outer Ring */}
      <circle
        cx="24"
        cy="24"
        r="14.5"
        fill="#00C2FF"
        stroke="#111111"
        strokeWidth="2.8"
      />
      {/* Stylized Shutter Blades */}
      <path
        d="M15 16 L24 12 M33 16 L36 24 M33 32 L24 36 M15 32 L12 24"
        stroke="#111111"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.35"
      />
      {/* Inner Lens Core */}
      <circle
        cx="24"
        cy="24"
        r="9.5"
        fill="#FFE4C4"
        stroke="#111111"
        strokeWidth="2.4"
      />
      {/* Electric Coral Lightning Bolt */}
      <polygon
        points="26,11 17,25 23.5,25 21.5,37 31,22.5 24.5,22.5"
        fill="#FF3B5C"
        stroke="#111111"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      {/* Sparkle Star Accent */}
      <polygon
        points="37,8 38.6,12.2 43,13.5 38.6,14.8 37,19 35.4,14.8 31,13.5 35.4,12.2"
        fill="#2EE59D"
        stroke="#111111"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DoodlePlaceholderArt({ className = "w-24 h-24" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      shapeRendering="crispEdges"
      className={className}
      aria-hidden="true"
    >
      <rect x="8" y="6" width="32" height="36" fill="#111111" />
      <rect x="10" y="8" width="28" height="32" fill="#FFF3E2" />
      <rect x="12" y="10" width="24" height="22" fill="#FFD60A" />
      <rect x="19" y="14" width="10" height="9" fill="#111111" />
      <rect x="20" y="15" width="8" height="7" fill="#FF3B5C" />
      <rect x="16" y="24" width="16" height="8" fill="#111111" />
      <rect x="17" y="25" width="14" height="7" fill="#00C2FF" />
      <rect x="20" y="17" width="3" height="2" fill="#111111" />
      <rect x="25" y="17" width="3" height="2" fill="#111111" />
      <rect x="23" y="17" width="2" height="1" fill="#111111" />
      <rect x="14" y="12" width="2" height="2" fill="#2EE59D" />
      <rect x="32" y="13" width="2" height="2" fill="#FFF3E2" />
    </svg>
  );
}
