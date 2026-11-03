import type { CommStats, Turn } from "./types";

// Multi-word fillers first so they aren't double counted.
const FILLERS: [string, RegExp][] = [
  ["you know", /\byou know\b/gi],
  ["i mean", /\bi mean\b/gi],
  ["kind of", /\bkind of\b/gi],
  ["sort of", /\bsort of\b/gi],
  ["um", /\b(um+|umm+|uhm+)\b/gi],
  ["uh", /\b(uh+|er+|ah+)\b/gi],
  ["hmm", /\bhm+\b/gi],
  ["basically", /\bbasically\b/gi],
  ["actually", /\bactually\b/gi],
  ["literally", /\bliterally\b/gi],
  ["like", /\blike,|,\s*like\b|\blike\s+like\b/gi],
];

export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

export function computeStats(transcript: Turn[]): CommStats {
  const answers = transcript.filter((t) => t.speaker === "candidate" && t.text.trim());
  const breakdown: Record<string, number> = {};
  let fillerCount = 0;
  for (const a of answers) {
    for (const [name, re] of FILLERS) {
      const n = a.text.match(re)?.length ?? 0;
      if (n) {
        breakdown[name] = (breakdown[name] ?? 0) + n;
        fillerCount += n;
      }
    }
  }
  const counts = answers.map((a) => wordCount(a.text));
  const totalWords = counts.reduce((x, y) => x + y, 0);
  const durations = answers.map((a) => a.durationSec).filter((d): d is number => typeof d === "number" && d > 0);
  return {
    fillerCount,
    fillerBreakdown: breakdown,
    totalWords,
    avgWordsPerAnswer: answers.length ? Math.round(totalWords / answers.length) : 0,
    longestAnswerWords: counts.length ? Math.max(...counts) : 0,
    avgAnswerSeconds: durations.length ? Math.round(durations.reduce((x, y) => x + y, 0) / durations.length) : null,
    answers: answers.length,
  };
}
