export function verdictClass(v: string) {
  return v === "hire" ? "bg-good/15 text-good" : v === "borderline" ? "bg-warn/15 text-warn" : "bg-bad/15 text-bad";
}

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

export function formatClock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
