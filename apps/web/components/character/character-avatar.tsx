import { OUTFITS, type CharacterConfig } from "./types";

const INK = "#16181c";
const SKIN = "#ffe4c8";
const STROKE = 3.5;

function Eyes({ color }: { color: string }) {
  return (
    <g>
      <circle cx="40" cy="52" fill={color} r="4.5" />
      <circle cx="64" cy="52" fill={color} r="4.5" />
    </g>
  );
}

function Hair({ base, color }: { base: CharacterConfig["base"]; color: string }) {
  if (base === "girl") {
    return (
      <g fill={color} stroke={INK} strokeLinejoin="round" strokeWidth={STROKE}>
        <circle cx="18" cy="58" r="10" />
        <circle cx="86" cy="58" r="10" />
        <path d="M22 44c0-16 12-26 30-26s30 10 30 26c0 3-1 6-2 8-3-9-13-13-28-13s-25 4-28 13c-1-2-2-5-2-8Z" />
      </g>
    );
  }
  return (
    <g fill={color} stroke={INK} strokeLinejoin="round" strokeWidth={STROKE}>
      <path d="M20 46c0-17 13-28 32-28s32 11 32 28c0 2 0 4-1 6-4-6-10-9-16-9H37c-6 0-12 3-16 9-1-2-1-4-1-6Z" />
    </g>
  );
}

export function CharacterAvatar({
  config,
  className,
}: {
  config: CharacterConfig;
  className?: string;
}) {
  const outfit = OUTFITS.find((o) => o.id === config.outfitId) ?? OUTFITS[0]!;
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 104 104">
      <path
        d="M8 104c2-19 16-32 44-32s42 13 44 32Z"
        fill={outfit.color}
        stroke={INK}
        strokeLinejoin="round"
        strokeWidth={STROKE}
      />
      <circle cx="52" cy="52" fill={SKIN} r="32" stroke={INK} strokeWidth={STROKE} />
      <Eyes color={config.eyeColor} />
      <path
        d="M45 68q7 6 14 0"
        fill="none"
        stroke={INK}
        strokeLinecap="round"
        strokeWidth={3}
      />
      <Hair base={config.base} color={config.hairColor} />
    </svg>
  );
}
