/** Convert configured overtime labels to the duration format used by payroll. */
export function normalizeOvertimeDuration(input: unknown): string | null {
  const value = String(input ?? "").trim();
  let seconds: number;
  const clock = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
  if (clock) {
    seconds = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3] ?? 0);
  } else {
    const hours = /^(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)(?:\s+(\d+)\s*(?:minutes?|mins?|m))?$/i.exec(value);
    const minutes = /^(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)$/i.exec(value);
    if (hours) {
      seconds = Number(hours[1]) * 3600 + Number(hours[2] ?? 0) * 60;
    } else if (minutes) {
      seconds = Number(minutes[1]) * 60;
    } else {
      return null;
    }
  }
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > 838 * 3600 + 59 * 60 + 59) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
