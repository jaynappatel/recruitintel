export type CharacterBase = "guy" | "girl";
export type OutfitId = "sun" | "game" | "cozy" | "denim";

export interface CharacterConfig {
  name: string;
  base: CharacterBase;
  hairColor: string;
  eyeColor: string;
  outfitId: OutfitId;
}

export const HAIR_COLORS = [
  { id: "espresso", label: "Espresso", value: "#2f2a26" },
  { id: "chestnut", label: "Chestnut", value: "#7a4a30" },
  { id: "honey", label: "Honey", value: "#e0ac5f" },
  { id: "platinum", label: "Platinum", value: "#f1e6cf" },
  { id: "coral", label: "Coral", value: "#ff5b35" },
  { id: "slate", label: "Slate", value: "#5b6470" },
] as const;

export const EYE_COLORS = [
  { id: "brown", label: "Brown", value: "#4a3324" },
  { id: "hazel", label: "Hazel", value: "#8a6a3f" },
  { id: "green", label: "Green", value: "#4f8a5b" },
  { id: "blue", label: "Blue", value: "#3f7db8" },
  { id: "gray", label: "Gray", value: "#6b7076" },
] as const;

export const OUTFITS: { id: OutfitId; label: string; color: string }[] = [
  { id: "sun", label: "Sunshine", color: "#ffd23f" },
  { id: "game", label: "Game day", color: "#ff5b35" },
  { id: "cozy", label: "Cozy", color: "#9bb89e" },
  { id: "denim", label: "Denim", color: "#4c7eb0" },
];

export const DEFAULT_CHARACTER: CharacterConfig = {
  name: "Scout",
  base: "girl",
  hairColor: HAIR_COLORS[0].value,
  eyeColor: EYE_COLORS[0].value,
  outfitId: "sun",
};
