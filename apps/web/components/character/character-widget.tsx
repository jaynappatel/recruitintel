"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { CharacterAvatar } from "./character-avatar";
import { CharacterCustomizer } from "./character-customizer";
import { hasGreetedToday, markGreetedToday, useCharacter } from "./use-character";

type Brief = { newMatches: number; appliedThisWeek: number; dueToday: number };

const HIDDEN_ROUTES = ["/sign-in"];

function greetingLine(brief: Brief | null, hour: number) {
  const timeOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  if (!brief) return `Good ${timeOfDay}. Let's see what's new for you today.`;
  const parts: string[] = [];
  if (brief.newMatches > 0)
    parts.push(`${brief.newMatches} new job${brief.newMatches === 1 ? "" : "s"} to look at`);
  if (brief.dueToday > 0)
    parts.push(`${brief.dueToday} thing${brief.dueToday === 1 ? "" : "s"} due today`);
  if (parts.length === 0) {
    return `Good ${timeOfDay}. Nothing urgent today — you've applied to ${brief.appliedThisWeek} role${brief.appliedThisWeek === 1 ? "" : "s"} this week. Keep it up.`;
  }
  return `You have ${parts.join(" and ")}. You've applied to ${brief.appliedThisWeek} role${brief.appliedThisWeek === 1 ? "" : "s"} this week.`;
}

export function CharacterWidget() {
  const pathname = usePathname();
  const { character, hydrated, updateCharacter } = useCharacter();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [customizerOpen, setCustomizerOpen] = useState(false);

  useEffect(() => {
    void fetch("/api/character/daily-brief", { credentials: "same-origin", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: { data: Brief } | null) => {
        if (json) setBrief(json.data);
      })
      .catch(() => setBrief(null));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (hasGreetedToday()) return;
    const timer = setTimeout(() => {
      setBubbleOpen(true);
      markGreetedToday();
    }, 900);
    return () => clearTimeout(timer);
  }, [hydrated]);

  if (!hydrated || HIDDEN_ROUTES.includes(pathname)) return null;

  const hasSignal = brief != null && (brief.newMatches > 0 || brief.dueToday > 0);

  return (
    <div className="fixed right-5 bottom-5 z-40 flex flex-col items-end gap-3">
      {bubbleOpen && (
        <div className="surface character-bubble-pop w-72 overflow-hidden">
          <div className="window-bar">
            <div className="window-bar-dots">
              <span />
              <span />
              <span />
            </div>
            <div className="window-bar-label flex-1">{character.name || "Update"}.app</div>
          </div>
          <div className="flex items-start gap-3 p-4">
            <CharacterAvatar className="size-11 shrink-0" config={character} />
            <p className="m-0 text-sm leading-5 text-[var(--ink)]">
              {greetingLine(brief, new Date().getHours())}
            </p>
          </div>
          <div className="flex items-center justify-between gap-2 border-t-[1.5px] border-[var(--line-strong)] p-3">
            <button
              className="text-xs font-bold text-[var(--muted)] hover:text-[var(--ink)]"
              onClick={() => {
                setCustomizerOpen(true);
                setBubbleOpen(false);
              }}
              type="button"
            >
              Customize
            </button>
            <Button onClick={() => setBubbleOpen(false)} size="sm">
              OK
            </Button>
          </div>
        </div>
      )}

      <button
        aria-label="Open your daily update"
        className="surface relative grid size-14 place-items-center overflow-hidden p-0"
        onClick={() => setBubbleOpen((open) => !open)}
        type="button"
      >
        <CharacterAvatar className="size-full" config={character} />
        {hasSignal && (
          <span className="absolute top-1 right-1 size-2.5 rounded-full border border-white bg-[var(--accent)]" />
        )}
      </button>

      {customizerOpen && (
        <CharacterCustomizer
          character={character}
          onChange={updateCharacter}
          onClose={() => setCustomizerOpen(false)}
        />
      )}
    </div>
  );
}
