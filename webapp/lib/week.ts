// ISO week helpers. JS Date doesn't natively expose ISO week numbers.

export function isoWeekKey(d: Date): string {
  // Returns YYYY-Www (e.g. 2026-W19) using ISO 8601 week numbering.
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7; // Mon=1 .. Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// The Monday that starts the ISO week containing `d`. Returns YYYY-MM-DD.
export function isoWeekStart(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - (day - 1));
  return date.toISOString().slice(0, 10);
}

export function weekKeyFromStart(weekStart: string): string {
  return isoWeekKey(new Date(weekStart + "T00:00:00Z"));
}
