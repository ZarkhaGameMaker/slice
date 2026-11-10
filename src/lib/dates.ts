// Toutes les dates sont manipulées en heure locale, au format ISO court.
// "YYYY-MM-DD" pour un jour, "YYYY-MM" pour un mois (month est 0-indexé dans les calculs).

export const pad = (n: number) => String(n).padStart(2, '0');

export const toISO = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayISO = () => toISO(new Date());

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const isoOf = (year: number, month: number, day: number) =>
  `${year}-${pad(month + 1)}-${pad(day)}`;

export const monthKey = (year: number, month: number) => `${year}-${pad(month + 1)}`;

export const monthKeyOf = (iso: string) => iso.slice(0, 7);

export function parseMonthKey(key: string) {
  const [y, m] = key.split('-').map(Number);
  return { year: y, month: m - 1 };
}

export function addMonths(key: string, n: number): string {
  const { year, month } = parseMonthKey(key);
  const total = year * 12 + month + n;
  return monthKey(Math.floor(total / 12), ((total % 12) + 12) % 12);
}

/** Nombre de mois pour aller de `a` à `b` (positif si b est après a). */
export function monthDiff(a: string, b: string): number {
  const pa = parseMonthKey(a);
  const pb = parseMonthKey(b);
  return pb.year * 12 + pb.month - (pa.year * 12 + pa.month);
}

export const daysInMonth = (year: number, month: number) =>
  new Date(year, month + 1, 0).getDate();

/** Nombre de jours de `a` à `b`, négatif si `b` est antérieur. */
export const daysBetween = (a: string, b: string) =>
  Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
