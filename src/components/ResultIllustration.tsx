interface ResultIllustrationProps {
  adventureIndex: number;
  label: string;
}

/**
 * Original decorative result artwork: a double helix medallion with a mood
 * accent. Purely decorative — the result name and percentages beside it carry
 * the meaning, so nothing here is the sole source of information.
 */
export function ResultIllustration({ adventureIndex, label }: ResultIllustrationProps) {
  const kind = adventureIndex < 25 ? "halo" : adventureIndex < 45 ? "playful" : adventureIndex < 85 ? "horns" : "flame";
  const gradientId = `result-strand-${kind}`;

  return (
    <svg
      aria-label={`${label} result illustration`}
      className="mx-auto h-36 w-36 drop-shadow-[0_0_28px_rgba(233,99,123,.25)]"
      role="img"
      viewBox="0 0 160 160"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop stopColor="#fff5e9" />
          <stop offset="1" stopColor="#e9637b" />
        </linearGradient>
      </defs>

      {/* Mood accent above the medallion. */}
      {kind === "halo" && (
        <ellipse cx="80" cy="24" fill="none" rx="30" ry="8" stroke="#fff5e9" strokeWidth="4" opacity=".9" />
      )}
      {kind === "playful" && (
        <g stroke="#fff5e9" strokeLinecap="round" strokeWidth="4" opacity=".9">
          <path d="M52 30 L52 18" />
          <path d="M80 26 L80 12" />
          <path d="M108 30 L108 18" />
        </g>
      )}
      {kind === "horns" && (
        <path
          d="M60 43 C 52 33 45 22 41 10 C 51 25 63 35 73 41 Z M100 43 C 108 33 115 22 119 10 C 109 25 97 35 87 41 Z"
          fill="#e9637b"
          opacity=".9"
        />
      )}
      {kind === "flame" && (
        <g>
          <path
            d="M80 3 C 95 19 93 30 86 38 C 83 41 80 42 80 42 C 80 42 77 41 74 38 C 67 30 65 19 80 3 Z"
            fill="#e9637b"
            opacity=".85"
          />
          <path d="M80 16 C 86 25 85 33 80 39 C 75 33 74 25 80 16 Z" fill="#fff5e9" opacity=".7" />
        </g>
      )}

      {/* Medallion. */}
      <circle cx="80" cy="92" fill="#e9637b" opacity=".08" r="52" />
      <circle cx="80" cy="92" fill="none" opacity=".45" r="52" stroke="#e9637b" strokeWidth="2" />

      {/* Double helix: two strands crossing three times, joined by rungs. */}
      <g fill="none" stroke={`url(#${gradientId})`} strokeLinecap="round" strokeWidth="5">
        <path d="M56 54 C 56 67, 104 79, 104 92 C 104 105, 56 117, 56 130" />
        <path d="M104 54 C 104 67, 56 79, 56 92 C 56 105, 104 117, 104 130" />
      </g>
      <g stroke="#fff5e9" strokeLinecap="round" strokeWidth="3" opacity=".55">
        <path d="M62 58 H98" />
        <path d="M63 87 H97" />
        <path d="M63 97 H97" />
        <path d="M62 126 H98" />
      </g>
    </svg>
  );
}
