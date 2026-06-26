export function startOfWeekMs(now = new Date(), timezone = 'Africa/Johannesburg'): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(`${map.year}-${map.month}-${map.day}T00:00:00+02:00`);
  const weekdays: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const weekday = map.weekday ?? 'Mon';
  date.setUTCDate(date.getUTCDate() - (weekdays[weekday] ?? 0));
  return date.getTime();
}

export function localDateKey(now = new Date(), timezone = 'Africa/Johannesburg'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
