interface ResultIllustrationProps {
  adventureIndex: number;
  label: string;
}

/** Original decorative result artwork. Text beside the image carries meaning. */
export function ResultIllustration({ adventureIndex, label }: ResultIllustrationProps) {
  const kind = adventureIndex < 25 ? "halo" : adventureIndex < 45 ? "playful" : adventureIndex < 85 ? "horns" : "flame";

  return (
    <svg
      aria-label={`${label} result illustration`}
      className="mx-auto h-36 w-36 drop-shadow-[0_0_28px_rgba(233,99,123,.25)]"
      role="img"
      viewBox="0 0 160 160"
    >
      <defs>
        <linearGradient id={`result-${kind}`} x1="0" x2="1" y1="0" y2="1">
          <stop stopColor="#fff5e9" />
          <stop offset="1" stopColor="#e9637b" />
        </linearGradient>
      </defs>
      {kind === "halo" && <ellipse cx="80" cy="30" fill="none" rx="35" ry="10" stroke="#fff5e9" strokeWidth="5" />}
      {kind === "playful" && <path d="M45 48 Q80 18 115 48" fill="none" stroke="#fff5e9" strokeLinecap="round" strokeWidth="5" />}
      {kind === "horns" && <path d="M48 56 Q22 35 30 14 Q57 30 62 51 M112 56 Q138 35 130 14 Q103 30 98 51" fill="none" stroke="#e9637b" strokeLinecap="round" strokeWidth="6" />}
      {kind === "flame" && <path d="M80 8 C105 36 91 50 116 69 C143 90 117 145 80 148 C38 145 25 99 48 72 C61 57 54 39 64 27 C65 49 82 54 80 8Z" fill={`url(#result-${kind})`} opacity=".25" stroke="#e9637b" strokeWidth="4" />}
      <circle cx="80" cy="86" fill={`url(#result-${kind})`} opacity=".14" r="47" stroke="#e9637b" strokeWidth="3" />
      <path d="M58 55 C110 73 49 100 102 122 M102 55 C50 73 111 100 58 122 M62 65 H98 M62 112 H98" fill="none" stroke={`url(#result-${kind})`} strokeLinecap="round" strokeWidth="5" />
    </svg>
  );
}
