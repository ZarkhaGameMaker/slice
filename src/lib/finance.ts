import { addMonths, daysInMonth, isoOf, monthKeyOf, parseISO, parseMonthKey, toISO } from './dates';
import type { Account, Entry, PeriodSetting, Recurring, Transaction, TxGroup, TxType } from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Date effective d'une opération automatique pour un mois donné.
 * - Le jour est ramené au dernier jour du mois s'il n'existe pas (ex. 31 → 30).
 * - Samedi → avancé au vendredi (ou reporté au lundi si on sortirait du mois).
 * - Dimanche → reporté au lundi (ou avancé au vendredi si on sortirait du mois).
 */
export function recurringDate(year: number, month: number, day: number): string {
  const dim = daysInMonth(year, month);
  let d = Math.min(Math.max(1, Math.round(day)), dim);
  const dow = new Date(year, month, d).getDay();
  if (dow === 6) d = d > 1 ? d - 1 : d + 2;
  else if (dow === 0) d = d < dim ? d + 1 : d - 2;
  return isoOf(year, month, d);
}

/** Génère les occurrences d'une opération automatique jusqu'au mois `untilMonth` inclus. */
export function expandRecurring(r: Recurring, untilMonth: string): Entry[] {
  const out: Entry[] = [];
  const last = r.endMonth && r.endMonth < untilMonth ? r.endMonth : untilMonth;
  let key = r.startMonth;
  for (let guard = 0; key <= last && guard < 1200; guard++) {
    if (!r.skipped.includes(key)) {
      const { year, month } = parseMonthKey(key);
      out.push({
        id: `rec:${r.id}:${key}`,
        accountId: r.accountId,
        type: r.type,
        amount: r.amount,
        date: recurringDate(year, month, r.day),
        label: r.label,
        category: r.category,
        recurringId: r.id,
        monthKey: key,
        budget: r.amount,
        budgetType: r.type,
      });
    }
    key = addMonths(key, 1);
  }
  return out;
}

/** Prochaines dates d'une règle à partir d'aujourd'hui (pour l'aperçu). */
export function nextOccurrences(r: Recurring, today: string, count: number): string[] {
  const out: string[] = [];
  let key = r.startMonth > monthKeyOf(today) ? r.startMonth : monthKeyOf(today);
  for (let guard = 0; out.length < count && guard < 240; guard++) {
    if (r.endMonth && key > r.endMonth) break;
    const { year, month } = parseMonthKey(key);
    const date = recurringDate(year, month, r.day);
    if (date >= today && !r.skipped.includes(key)) out.push(date);
    key = addMonths(key, 1);
  }
  return out;
}

/** Jour de début des périodes, ou null pour des mois calendaires. */
export function periodDay(setting: PeriodSetting, recurrings: Recurring[]): number | null {
  if (setting.kind === 'day') return setting.day;
  if (setting.kind === 'rule') return recurrings.find((r) => r.id === setting.recurringId)?.day ?? null;
  return null;
}

/** Premier jour de la période qui porte la clé `key` (YYYY-MM). */
export function periodStartDate(key: string, day: number | null): string {
  const { year, month } = parseMonthKey(key);
  return day === null ? isoOf(year, month, 1) : recurringDate(year, month, day);
}

/** Clé de la période qui contient `date` : avant le jour de début, on est encore dans la période précédente. */
export function periodKeyOf(date: string, day: number | null): string {
  const key = monthKeyOf(date);
  return periodStartDate(key, day) <= date ? key : addMonths(key, -1);
}

/**
 * Net d'un groupe d'opérations : les dépenses moins les revenus. C'est le montant retenu par
 * défaut — 96 € de restaurant moins 64 € remboursés font 32 € de restaurant.
 */
export function groupNet(members: { type: TxType; amount: number }[]): { amount: number; type: TxType } {
  let sum = 0;
  for (const m of members) sum += m.type === 'expense' ? m.amount : -m.amount;
  return { amount: round2(Math.abs(sum)), type: sum >= 0 ? 'expense' : 'income' };
}

/**
 * Applique les groupes aux opérations d'une chronologie : les membres secondaires ne comptent
 * plus dans les indicateurs, l'opération principale porte le montant du groupe. Un groupe dont
 * un seul membre est visible ici (l'autre compte n'est pas affiché) reste inchangé.
 */
function applyGroups(entries: Entry[], groups: TxGroup[]) {
  if (!groups.length) return;
  const members = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!e.groupId) continue;
    const list = members.get(e.groupId);
    if (list) list.push(e);
    else members.set(e.groupId, [e]);
  }
  for (const g of groups) {
    const list = members.get(g.id);
    if (!list || list.length < 2) continue;
    const lead = list.find((e) => e.id === g.leadId) ?? list[0];
    const net = groupNet(list);
    for (const e of list) e.budget = 0;
    lead.budget = g.amount ?? net.amount;
    lead.budgetType = g.type ?? net.type;
  }
}

export interface DayPoint {
  date: string;
  /** Jour du mois calendaire (1-31). */
  day: number;
  income: number;
  expense: number;
  /** Solde en fin de journée. */
  balance: number;
  future: boolean;
  entries: Entry[];
  /** Dépense/revenu estimés du jour d'après les mois terminés (0 pour un jour passé). */
  estIncome: number;
  estExpense: number;
  /** Solde en fin de journée, estimations comprises (= balance tant qu'il n'y a rien d'estimé). */
  estBalance: number;
}

/** Une période (un « mois ») : calendaire, ou d'un jour de paie au suivant. */
export interface MonthData {
  /** Mois (YYYY-MM) où la période commence. */
  key: string;
  year: number;
  month: number;
  /** Premier et dernier jour inclus. */
  start: string;
  end: string;
  days: DayPoint[];
  income: number;
  expense: number;
  /**
   * Part exceptionnelle (hors budget) des deux totaux ci-dessus : déjà comprise dedans et dans
   * le solde, mais à retirer pour les indicateurs (voir ordinaryIncome / ordinaryExpense).
   */
  oneOffIncome: number;
  oneOffExpense: number;
  /**
   * Totaux retenus par les indicateurs : groupes appliqués, opérations exceptionnelles écartées.
   * Voir ordinaryIncome / ordinaryExpense, par lesquels tout le reste de l'app y accède.
   */
  budgetIncome: number;
  budgetExpense: number;
  openingBalance: number;
  closingBalance: number;
  entries: Entry[];
  /** Totaux et soldes de la période, estimations comprises. */
  estIncome: number;
  estExpense: number;
  estOpening: number;
  estClosing: number;
}

export interface Timeline {
  months: MonthData[];
  /** Solde à la fin de la journée d'aujourd'hui. */
  balanceToday: number;
  /** Une estimation a été ajoutée aux jours à venir (il fallait au moins un mois terminé). */
  forecast: boolean;
}

/**
 * Revenus et dépenses « ordinaires » de la période : les opérations marquées exceptionnelles
 * en sont retirées. C'est la base du bilan, du taux d'épargne, des moyennes et de la prévision ;
 * les soldes, eux, comptent toujours tout (l'argent est bien là).
 */
export const ordinaryIncome = (m: MonthData) => m.budgetIncome;
export const ordinaryExpense = (m: MonthData) => m.budgetExpense;

export const monthIndexOf = (months: MonthData[], date: string) =>
  months.findIndex((m) => m.start <= date && date <= m.end);

interface BuildOptions {
  accounts: Account[];
  transactions: Transaction[];
  recurrings: Recurring[];
  /** Groupes d'opérations : ils changent ce que les indicateurs retiennent, jamais le solde. */
  groups?: TxGroup[];
  accountIds: string[];
  today: string;
  /** Nombre de mois de projection après le mois courant. */
  futureMonths?: number;
  /** Jour de début des périodes (voir periodDay), null = calendaire. */
  startDay?: number | null;
}

export function buildTimeline({
  accounts,
  transactions,
  recurrings,
  groups = [],
  accountIds,
  today,
  futureMonths = 3,
  startDay = null,
}: BuildOptions): Timeline {
  const ids = new Set(accountIds);
  const selected = accounts.filter((a) => ids.has(a.id));
  const keyOf = (date: string) => periodKeyOf(date, startDay);
  const todayKey = keyOf(today);

  const txs = transactions.filter((t) => ids.has(t.accountId));
  const recs = recurrings.filter((r) => ids.has(r.accountId));

  let earliest = today;
  for (const a of selected) if (a.startDate < earliest) earliest = a.startDate;
  for (const t of txs) if (t.date < earliest) earliest = t.date;
  for (const r of recs) {
    const { year, month } = parseMonthKey(r.startMonth);
    const first = recurringDate(year, month, r.day);
    if (first < earliest) earliest = first;
  }
  const startKey = keyOf(earliest);

  let endKey = addMonths(todayKey, futureMonths);
  const maxEnd = addMonths(todayKey, 36);
  for (const t of txs) {
    const k = keyOf(t.date);
    if (k > endKey) endKey = k < maxEnd ? k : maxEnd;
  }

  // La dernière période déborde sur le mois suivant : on génère une échéance de plus.
  const entries: Entry[] = [
    ...txs.map((t) => ({ ...t, budget: t.amount, budgetType: t.type })),
    ...recs.flatMap((r) => expandRecurring(r, addMonths(endKey, 1))),
  ];
  applyGroups(entries, groups);
  const byDate = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = byDate.get(e.date);
    if (list) list.push(e);
    else byDate.set(e.date, [e]);
  }

  let balance = round2(selected.reduce((s, a) => s + a.initialBalance, 0));
  let balanceToday = balance;
  const months: MonthData[] = [];

  // Aucune opération n'est antérieure à la première période (startKey contient la plus ancienne date).
  for (let key = startKey, guard = 0; key <= endKey && guard < 1200; key = addMonths(key, 1), guard++) {
    const { year, month } = parseMonthKey(key);
    const start = periodStartDate(key, startDay);
    const next = periodStartDate(addMonths(key, 1), startDay);
    const openingBalance = balance;
    const days: DayPoint[] = [];
    let mIncome = 0;
    let mExpense = 0;
    let mOneOffIncome = 0;
    let mOneOffExpense = 0;
    let mBudgetIncome = 0;
    let mBudgetExpense = 0;
    const monthEntries: Entry[] = [];

    for (let cursor = parseISO(start); ; cursor.setDate(cursor.getDate() + 1)) {
      const date = toISO(cursor);
      if (date >= next) break;
      const dayEntries = byDate.get(date) ?? [];
      let income = 0;
      let expense = 0;
      for (const e of dayEntries) {
        // Le solde suit le montant réel ; les indicateurs suivent le montant retenu.
        if (e.type === 'income') income += e.amount;
        else expense += e.amount;
        if (e.budget === 0) continue;
        if (e.budgetType === 'income') {
          if (e.exceptional) mOneOffIncome += e.budget;
          else mBudgetIncome += e.budget;
        } else if (e.exceptional) mOneOffExpense += e.budget;
        else mBudgetExpense += e.budget;
      }
      income = round2(income);
      expense = round2(expense);
      balance = round2(balance + income - expense);
      if (date <= today) balanceToday = balance;
      mIncome += income;
      mExpense += expense;
      monthEntries.push(...dayEntries);
      days.push({
        date,
        day: cursor.getDate(),
        income,
        expense,
        balance,
        future: date > today,
        entries: dayEntries,
        estIncome: 0,
        estExpense: 0,
        estBalance: balance,
      });
    }

    months.push({
      key,
      year,
      month,
      start,
      end: days[days.length - 1].date,
      days,
      income: round2(mIncome),
      expense: round2(mExpense),
      oneOffIncome: round2(mOneOffIncome),
      oneOffExpense: round2(mOneOffExpense),
      budgetIncome: round2(mBudgetIncome),
      budgetExpense: round2(mBudgetExpense),
      openingBalance,
      closingBalance: balance,
      entries: monthEntries,
      estIncome: round2(mIncome),
      estExpense: round2(mExpense),
      estOpening: openingBalance,
      estClosing: balance,
    });
  }

  return { months, balanceToday, forecast: applyForecast(months, today) };
}

/** Nombre de mois terminés sur lesquels la prévision se règle. */
const FORECAST_MONTHS = 12;

/**
 * Prévision des jours à venir d'après les mois terminés : on complète les opérations déjà connues
 * (saisies et automatiques) jusqu'au niveau habituel de la période, réparti sur les jours restants.
 * Un mois où le niveau habituel est déjà atteint n'est pas gonflé. Les montants réels ne sont jamais
 * modifiés : tout est dans les champs est*, le reste de l'app continue de montrer ce qui est certain.
 */
function applyForecast(months: MonthData[], today: string): boolean {
  const done = months.filter((m) => m.end < today).slice(-FORECAST_MONTHS);
  if (!done.length) return false;
  const avgIncome = done.reduce((s, m) => s + ordinaryIncome(m), 0) / done.length;
  const avgExpense = done.reduce((s, m) => s + ordinaryExpense(m), 0) / done.length;
  // Décalage cumulé du solde : une fois estimé, il se répercute sur tous les jours suivants.
  let drift = 0;
  let used = false;
  for (const m of months) {
    const ahead = m.days.reduce((n, d) => n + (d.future ? 1 : 0), 0);
    // Un cadeau reçu ne « remplit » pas le niveau habituel de revenus : on compare l'ordinaire.
    const perIncome = ahead ? round2(Math.max(0, avgIncome - ordinaryIncome(m)) / ahead) : 0;
    const perExpense = ahead ? round2(Math.max(0, avgExpense - ordinaryExpense(m)) / ahead) : 0;
    if (perIncome > 0 || perExpense > 0) used = true;
    m.estOpening = round2(m.openingBalance + drift);
    for (const d of m.days) {
      if (d.future) {
        d.estIncome = perIncome;
        d.estExpense = perExpense;
        drift = round2(drift + perIncome - perExpense);
      }
      d.estBalance = round2(d.balance + drift);
    }
    m.estIncome = round2(m.income + perIncome * ahead);
    m.estExpense = round2(m.expense + perExpense * ahead);
    m.estClosing = round2(m.closingBalance + drift);
  }
  return used;
}

export interface CategoryAverage {
  id: string;
  /** Total de la catégorie sur les mois retenus. */
  total: number;
  /** Total ÷ nombre de mois retenus. */
  average: number;
  /** Nombre d'opérations. */
  count: number;
  /** Nombre de mois retenus où la catégorie apparaît. */
  months: number;
}

export interface AverageWindow {
  /** Mois retenus, du plus ancien au plus récent (vide s'il n'y en a aucun). */
  months: MonthData[];
  /** Catégories triées du plus gros total au plus petit. */
  categories: CategoryAverage[];
  /** Moyenne par mois, toutes catégories confondues. */
  average: number;
  total: number;
}

/**
 * Moyenne par mois de chaque catégorie, sur les derniers mois terminés : le mois en cours
 * et les projections sont écartés, ils tireraient la moyenne vers le bas. Les opérations
 * exceptionnelles n'y entrent pas : elles ne sont pas des habitudes, et un groupe ne compte
 * que par son montant retenu.
 * `limit` = nombre de mois maximum à retenir (0 = tout l'historique).
 */
export function categoryAverages(months: MonthData[], type: TxType, today: string, limit = 12): AverageWindow {
  const done = months.filter((m) => m.end < today);
  const kept = limit > 0 ? done.slice(-limit) : done;
  const map = new Map<string, CategoryAverage>();
  for (const m of kept) {
    const seen = new Set<string>();
    for (const e of m.entries) {
      if (e.budgetType !== type || e.exceptional || e.budget === 0) continue;
      const g = map.get(e.category) ?? { id: e.category, total: 0, average: 0, count: 0, months: 0 };
      g.total += e.budget;
      g.count++;
      if (!seen.has(e.category)) {
        g.months++;
        seen.add(e.category);
      }
      map.set(e.category, g);
    }
  }
  // Une catégorie absente d'un mois y compte pour 0 € : la moyenne porte toujours sur tous les mois retenus.
  const divisor = kept.length || 1;
  const categories = [...map.values()]
    .map((g) => ({ ...g, total: round2(g.total), average: round2(g.total / divisor) }))
    .sort((a, b) => b.total - a.total);
  const total = round2(categories.reduce((s, g) => s + g.total, 0));
  return { months: kept, categories, total, average: round2(total / divisor) };
}
