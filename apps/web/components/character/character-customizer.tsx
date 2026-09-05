"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

import { CharacterAvatar } from "./character-avatar";
import { EYE_COLORS, HAIR_COLORS, OUTFITS, type CharacterConfig } from "./types";

function SwatchRow({
  label,
  swatches,
  activeValue,
  onPick,
}: {
  label: string;
  swatches: readonly { id: string; label: string; value: string }[];
  activeValue: string;
  onPick: (value: string) => void;
}) {
  return (
    <div>
      <div className="window-bar-label mb-2">{label}</div>
      <div className="flex flex-wrap gap-2.5">
        {swatches.map((swatch) => (
          <button
            aria-label={swatch.label}
            aria-pressed={activeValue === swatch.value}
            className="grid size-8 place-items-center rounded-full border-[1.5px] transition-all"
            key={swatch.id}
            onClick={() => onPick(swatch.value)}
            style={{
              backgroundColor: swatch.value,
              borderColor: activeValue === swatch.value ? "var(--ink)" : "var(--line)",
              boxShadow: activeValue === swatch.value ? "0 0 0 2px var(--accent-soft)" : "none",
            }}
            title={swatch.label}
            type="button"
          />
        ))}
      </div>
    </div>
  );
}

export function CharacterCustomizer({
  character,
  onChange,
  onClose,
}: {
  character: CharacterConfig;
  onChange: (patch: Partial<CharacterConfig>) => void;
  onClose: () => void;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(22_24_28_/_55%)] p-4"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="surface character-bubble-pop w-full max-w-sm overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="window-bar">
          <div className="window-bar-dots">
            <span />
            <span />
            <span />
          </div>
          <div className="window-bar-label flex-1">Customize</div>
          <button
            aria-label="Close"
            className="grid size-6 place-items-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-soft)]"
            onClick={onClose}
            type="button"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="p-5">
          <div className="mb-5 flex items-center gap-4">
            <CharacterAvatar className="size-20 shrink-0" config={character} />
            <input
              className="min-w-0 flex-1 rounded-[var(--radius-sm)] border-[1.5px] border-[var(--line-strong)] px-3 py-2 text-sm font-semibold"
              maxLength={24}
              onChange={(event) => onChange({ name: event.target.value })}
              placeholder="Give them a name"
              value={character.name}
            />
          </div>

          <div className="space-y-5">
            <div>
              <div className="window-bar-label mb-2">Style</div>
              <div className="flex gap-2">
                {(["girl", "guy"] as const).map((base) => (
                  <button
                    className="flex-1 rounded-[var(--radius-sm)] border-[1.5px] px-4 py-2 text-sm font-bold transition-all"
                    key={base}
                    onClick={() => onChange({ base })}
                    style={{
                      borderColor: character.base === base ? "var(--ink)" : "var(--line)",
                      background: character.base === base ? "var(--surface-soft)" : "transparent",
                    }}
                    type="button"
                  >
                    {base === "girl" ? "Girl" : "Guy"}
                  </button>
                ))}
              </div>
            </div>

            <SwatchRow
              activeValue={character.hairColor}
              label="Hair color"
              onPick={(value) => onChange({ hairColor: value })}
              swatches={HAIR_COLORS}
            />

            <SwatchRow
              activeValue={character.eyeColor}
              label="Eye color"
              onPick={(value) => onChange({ eyeColor: value })}
              swatches={EYE_COLORS}
            />

            <div>
              <div className="window-bar-label mb-2">Outfit</div>
              <div className="grid grid-cols-2 gap-2">
                {OUTFITS.map((outfit) => (
                  <button
                    className="flex items-center gap-2 rounded-[var(--radius-sm)] border-[1.5px] px-3 py-2 text-left text-xs font-bold transition-all"
                    key={outfit.id}
                    onClick={() => onChange({ outfitId: outfit.id })}
                    style={{
                      borderColor: character.outfitId === outfit.id ? "var(--ink)" : "var(--line)",
                      background:
                        character.outfitId === outfit.id ? "var(--surface-soft)" : "transparent",
                    }}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="size-3 shrink-0 rounded-full border border-[var(--line-strong)]"
                      style={{ backgroundColor: outfit.color }}
                    />
                    {outfit.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Button className="mt-6 w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
