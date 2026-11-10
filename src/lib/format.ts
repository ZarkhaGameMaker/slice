import { parseISO, parseMonthKey } from './dates';

/** Arrondi au centime : la règle d'arrondi de toute l'application tient ici. */
export const round2 = (n: number) => Math.round(n * 100) / 100;
/** Marque du pluriel français : « 2 opération${plural(2)} ». */
export const plural = (n: number) => (n > 1 ? 's' : '');

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const eurRound = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});
const eurCompact = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const money = (n: number) => eur.format(n);
export const moneyRound = (n: number) => eurRound.format(n);
export const moneyCompact = (n: number) => (Math.abs(n) < 1000 ? eurRound.format(n) : eurCompact.format(n));
const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');
export const signedMoney = (n: number) => sign(n) + eur.format(Math.abs(n));
export const signedMoneyRound = (n: number) => sign(Math.round(n)) + eurRound.format(Math.abs(n));

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const monthLong = new Intl.DateTimeFormat('fr-FR', { month: 'long' });
const monthShort = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const dayLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const dayMedium = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const dayFull = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function monthName(key: string) {
  const { year, month } = parseMonthKey(key);
  return capitalize(monthLong.format(new Date(year, month, 1)));
}

export function monthShortName(key: string) {
  const { year, month } = parseMonthKey(key);
  return monthShort.format(new Date(year, month, 1)).replace('.', '');
}

export const monthLabel = (key: string) => `${monthName(key)} ${key.slice(0, 4)}`;

export const dayLabel = (iso: string) => capitalize(dayLong.format(parseISO(iso)));
export const dayShort = (iso: string) => dayMedium.format(parseISO(iso));
/** "4 sept." */
export const dayMonthShort = (iso: string) => dayMonth.format(parseISO(iso));
/** "4 sept. → 5 oct." */
export const periodRange = (start: string, end: string) =>
  `${dayMonth.format(parseISO(start))} → ${dayMonth.format(parseISO(end))}`;

export const dayFullLabel = (iso: string) => capitalize(dayFull.format(parseISO(iso)));

/** Convertit une saisie utilisateur ("1 234,56") en nombre. */
export function parseAmount(input: string): number {
  const cleaned = input.replace(/[\s\u00a0\u202f€]/g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? round2(n) : NaN;
}

export const amountToInput = (n: number) => String(n).replace('.', ',');
