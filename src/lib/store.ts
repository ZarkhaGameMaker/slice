import { useEffect, useReducer, useState } from 'react';
import { addMonths, isoOf, monthKeyOf, parseISO, todayISO } from './dates';
import type { Account, AppState, CustomCategory, PeriodSetting, Recurring, ThemeMode, Transaction, TxGroup, TxType } from './types';

const STORAGE_KEY = 'slice:v1';
/**
 * Clé d'avant le changement de nom (l'application s'appelait « Mes Comptes »).
 * Relue si la nouvelle est vide, et laissée en place : elle sert de filet.
 */
const LEGACY_KEY = 'mes-comptes:v1';

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const prefersLight = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;

export const emptyState = (): AppState => ({
  version: 1,
  accounts: [],
  transactions: [],
  recurrings: [],
  theme: prefersLight() ? 'light' : 'dark',
  period: { kind: 'calendar' },
  primaryId: null,
  categories: [],
  groups: [],
});

function sanitizePeriod(raw: unknown): PeriodSetting {
  const p = raw as Partial<{ kind: string; day: unknown; recurringId: unknown }> | null;
  if (p?.kind === 'day' && typeof p.day === 'number' && p.day >= 1 && p.day <= 31) return { kind: 'day', day: Math.round(p.day) };
  if (p?.kind === 'rule' && typeof p.recurringId === 'string') return { kind: 'rule', recurringId: p.recurringId };
  return { kind: 'calendar' };
}

const isType = (v: unknown): v is TxType => v === 'income' || v === 'expense';

function sanitizeCategories(raw: unknown): CustomCategory[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (c): c is CustomCategory =>
        !!c && typeof c.id === 'string' && typeof c.label === 'string' && typeof c.icon === 'string' && isType(c.type),
    )
    .map((c) => ({ id: c.id, label: c.label.slice(0, 30), icon: c.icon.slice(0, 4), type: c.type }));
}

function sanitizeGroups(raw: unknown, transactions: Transaction[]): TxGroup[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(transactions.map((t) => t.id));
  return (raw as Partial<TxGroup>[])
    .filter(
      (g): g is TxGroup =>
        !!g && typeof g.id === 'string' && typeof g.label === 'string' && typeof g.leadId === 'string',
    )
    // Un groupe dont l'opération principale a disparu n'a plus de sens.
    .filter((g) => known.has(g.leadId) && transactions.filter((t) => t.groupId === g.id).length > 1)
    .map((g) => ({
      id: g.id,
      label: g.label.slice(0, 60),
      leadId: g.leadId,
      ...(typeof g.amount === 'number' && g.amount >= 0 ? { amount: g.amount } : {}),
      ...(isType(g.type) ? { type: g.type } : {}),
    }));
}

/** Vérifie grossièrement la forme d'un état (chargé ou importé). */
export function sanitizeState(raw: unknown): AppState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<AppState>;
  if (!Array.isArray(s.accounts) || !Array.isArray(s.transactions) || !Array.isArray(s.recurrings)) return null;
  return {
    version: 1,
    accounts: s.accounts,
    transactions: s.transactions,
    recurrings: s.recurrings.map((r) => ({ ...r, skipped: Array.isArray(r.skipped) ? r.skipped : [] })),
    theme: s.theme === 'light' ? 'light' : 'dark',
    period: sanitizePeriod(s.period),
    primaryId:
      typeof s.primaryId === 'string' && s.accounts.some((a) => a.id === s.primaryId) ? s.primaryId : null,
    categories: sanitizeCategories(s.categories),
    groups: sanitizeGroups(s.groups, s.transactions),
  };
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (raw) return sanitizeState(JSON.parse(raw)) ?? emptyState();
  } catch {
    /* stockage indisponible : on repart d'un état vide */
  }
  return emptyState();
}

export type Action =
  | { type: 'account/add'; account: Account }
  | { type: 'account/update'; account: Account }
  | { type: 'account/delete'; id: string }
  | { type: 'account/restore'; account: Account; transactions: Transaction[]; recurrings: Recurring[]; primary: boolean }
  | { type: 'account/primary'; id: string | null }
  /** Met un compte de côté (ou le remet en service) sans toucher à ses opérations. */
  | { type: 'account/archive'; id: string; archived: boolean }
  | { type: 'account/reorder'; ids: string[] }
  | { type: 'tx/add'; tx: Transaction }
  | { type: 'tx/update'; tx: Transaction }
  | { type: 'tx/delete'; id: string }
  | {
      type: 'tx/import';
      transactions: Transaction[];
      skips: { id: string; month: string }[];
      /** Numéro de compte du relevé → compte qui l'a reçu, retenu pour les prochains imports. */
      links: { accountId: string; bankRef: string }[];
    }
  | {
      type: 'tx/unimport';
      ids: string[];
      skips: { id: string; month: string }[];
      /** Numéros de compte liés avant l'import, par compte, à rétablir. */
      bankRefs: Record<string, string[] | undefined>;
    }
  | { type: 'rec/add'; rec: Recurring }
  | { type: 'rec/update'; rec: Recurring }
  | { type: 'rec/delete'; id: string }
  | { type: 'rec/skip'; id: string; month: string }
  | { type: 'rec/unskip'; id: string; month: string }
  /** Crée ou modifie un groupe : `members` remplace entièrement sa composition. */
  | { type: 'group/save'; group: TxGroup; members: string[] }
  /** Dissout le groupe : les opérations redeviennent indépendantes. */
  | { type: 'group/delete'; id: string }
  | { type: 'category/add'; category: CustomCategory }
  | { type: 'category/update'; category: CustomCategory }
  | { type: 'category/delete'; id: string }
  | { type: 'theme'; theme: ThemeMode }
  | { type: 'period'; period: PeriodSetting }
  | { type: 'replace'; state: AppState };

/** Si les périodes suivaient une opération supprimée, on garde son jour pour ne pas changer le découpage. */
function keepPeriodDay(state: AppState, removed: Recurring[]): PeriodSetting {
  const { period } = state;
  if (period.kind !== 'rule') return period;
  const rule = removed.find((r) => r.id === period.recurringId);
  return rule ? { kind: 'day', day: rule.day } : period;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'account/add':
      return { ...state, accounts: [...state.accounts, action.account] };
    case 'account/update':
      return { ...state, accounts: state.accounts.map((a) => (a.id === action.account.id ? action.account : a)) };
    case 'account/delete':
      return {
        ...state,
        period: keepPeriodDay(state, state.recurrings.filter((r) => r.accountId === action.id)),
        primaryId: state.primaryId === action.id ? null : state.primaryId,
        accounts: state.accounts.filter((a) => a.id !== action.id),
        transactions: state.transactions.filter((t) => t.accountId !== action.id),
        recurrings: state.recurrings.filter((r) => r.accountId !== action.id),
      };
    case 'account/restore':
      return {
        ...state,
        primaryId: action.primary ? action.account.id : state.primaryId,
        accounts: [...state.accounts, action.account],
        transactions: [...state.transactions, ...action.transactions],
        recurrings: [...state.recurrings, ...action.recurrings],
      };
    case 'account/primary':
      return { ...state, primaryId: action.id };
    case 'account/archive':
      return {
        ...state,
        // Un compte mis de côté ne peut plus être celui qui s'ouvre au démarrage.
        primaryId: action.archived && state.primaryId === action.id ? null : state.primaryId,
        accounts: state.accounts.map((a) =>
          a.id === action.id ? { ...a, archived: action.archived || undefined } : a,
        ),
      };
    case 'account/reorder': {
      const rank = new Map(action.ids.map((id, i) => [id, i]));
      const last = action.ids.length;
      return {
        ...state,
        accounts: [...state.accounts].sort((a, b) => (rank.get(a.id) ?? last) - (rank.get(b.id) ?? last)),
      };
    }
    case 'tx/add':
      return { ...state, transactions: [...state.transactions, action.tx] };
    case 'tx/update':
      return { ...state, transactions: state.transactions.map((t) => (t.id === action.tx.id ? action.tx : t)) };
    case 'tx/delete':
      return withGroups({ ...state, transactions: state.transactions.filter((t) => t.id !== action.id) });
    case 'tx/import': {
      // Les lignes qui remplacent une échéance automatique la font ignorer pour ce mois-là.
      const skip = new Map<string, string[]>();
      for (const k of action.skips) skip.set(k.id, [...(skip.get(k.id) ?? []), k.month]);
      const links = action.links.filter((l) => l.bankRef);
      const linkedRefs = new Set(links.map((l) => l.bankRef));
      return {
        ...state,
        // Un numéro de compte n'appartient qu'à un seul compte de l'app.
        accounts: links.length
          ? state.accounts.map((a) => {
              const kept = (a.bankRefs ?? []).filter((ref) => !linkedRefs.has(ref));
              const added = links.filter((l) => l.accountId === a.id).map((l) => l.bankRef);
              const refs = [...kept, ...added];
              return refs.length || a.bankRefs ? { ...a, bankRefs: refs } : a;
            })
          : state.accounts,
        transactions: [...state.transactions, ...action.transactions],
        recurrings: state.recurrings.map((r) =>
          skip.has(r.id) ? { ...r, skipped: [...new Set([...r.skipped, ...skip.get(r.id)!])].sort() } : r,
        ),
      };
    }
    case 'tx/unimport': {
      const ids = new Set(action.ids);
      const unskip = new Map<string, Set<string>>();
      for (const k of action.skips) unskip.set(k.id, new Set([...(unskip.get(k.id) ?? []), k.month]));
      return {
        ...state,
        accounts: state.accounts.map((a) =>
          a.id in action.bankRefs ? { ...a, bankRefs: action.bankRefs[a.id] } : a,
        ),
        transactions: state.transactions.filter((t) => !ids.has(t.id)),
        recurrings: state.recurrings.map((r) =>
          unskip.has(r.id) ? { ...r, skipped: r.skipped.filter((m) => !unskip.get(r.id)!.has(m)) } : r,
        ),
      };
    }
    case 'rec/add':
      return { ...state, recurrings: [...state.recurrings, action.rec] };
    case 'rec/update':
      return { ...state, recurrings: state.recurrings.map((r) => (r.id === action.rec.id ? action.rec : r)) };
    case 'rec/delete':
      return {
        ...state,
        period: keepPeriodDay(state, state.recurrings.filter((r) => r.id === action.id)),
        recurrings: state.recurrings.filter((r) => r.id !== action.id),
      };
    case 'rec/skip':
      return {
        ...state,
        recurrings: state.recurrings.map((r) =>
          r.id === action.id && !r.skipped.includes(action.month)
            ? { ...r, skipped: [...r.skipped, action.month].sort() }
            : r,
        ),
      };
    case 'rec/unskip':
      return {
        ...state,
        recurrings: state.recurrings.map((r) =>
          r.id === action.id ? { ...r, skipped: r.skipped.filter((m) => m !== action.month) } : r,
        ),
      };
    case 'group/save': {
      const members = new Set(action.members);
      return withGroups({
        ...state,
        transactions: state.transactions.map((t) =>
          members.has(t.id) ? { ...t, groupId: action.group.id }
          : t.groupId === action.group.id ? { ...t, groupId: undefined }
          : t,
        ),
        groups: state.groups.some((g) => g.id === action.group.id)
          ? state.groups.map((g) => (g.id === action.group.id ? action.group : g))
          : [...state.groups, action.group],
      });
    }
    case 'group/delete':
      return {
        ...state,
        transactions: state.transactions.map((t) => (t.groupId === action.id ? { ...t, groupId: undefined } : t)),
        groups: state.groups.filter((g) => g.id !== action.id),
      };
    case 'category/add':
      return { ...state, categories: [...state.categories, action.category] };
    case 'category/update':
      return {
        ...state,
        categories: state.categories.map((c) => (c.id === action.category.id ? action.category : c)),
      };
    case 'category/delete':
      // Les opérations qui l'utilisaient retombent sur « Autre » : aucune ne reste orpheline.
      return {
        ...state,
        categories: state.categories.filter((c) => c.id !== action.id),
        transactions: state.transactions.map((t) => (t.category === action.id ? { ...t, category: 'autre' } : t)),
        recurrings: state.recurrings.map((r) => (r.category === action.id ? { ...r, category: 'autre' } : r)),
      };
    case 'theme':
      return { ...state, theme: action.theme };
    case 'period':
      return { ...state, period: action.period };
    case 'replace':
      return action.state;
  }
}

function storageWorks() {
  try {
    const key = `${STORAGE_KEY}:test`;
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** État de l'app + indicateur `saved` : false si le navigateur refuse d'enregistrer. */
export function useAppStore() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [saved, setSaved] = useState(storageWorks);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setSaved(true);
    } catch {
      // Quota dépassé ou stockage bloqué : l'app reste utilisable, mais l'utilisateur est prévenu.
      setSaved(false);
    }
  }, [state]);
  return [state, dispatch, saved] as const;
}

/** Petit générateur pseudo-aléatoire déterministe pour les données de démo. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/**
 * Remet les groupes d'équerre après une modification des opérations : un groupe tombé à moins
 * de deux membres est dissous, et un groupe qui a perdu son opération principale en reprend une.
 */
function withGroups(state: AppState): AppState {
  const members = new Map<string, Transaction[]>();
  for (const t of state.transactions) {
    if (!t.groupId) continue;
    const list = members.get(t.groupId);
    if (list) list.push(t);
    else members.set(t.groupId, [t]);
  }
  const groups: TxGroup[] = [];
  const dissous = new Set<string>();
  for (const g of state.groups) {
    const list = members.get(g.id) ?? [];
    if (list.length < 2) {
      dissous.add(g.id);
      continue;
    }
    groups.push(list.some((t) => t.id === g.leadId) ? g : { ...g, leadId: list[0].id });
  }
  // Opérations restées rattachées à un groupe disparu.
  const orphelines = state.transactions.some((t) => t.groupId && !groups.some((g) => g.id === t.groupId));
  return {
    ...state,
    groups,
    transactions: orphelines
      ? state.transactions.map((t) => (t.groupId && dissous.has(t.groupId) ? { ...t, groupId: undefined } : t))
      : state.transactions,
  };
}

export function demoState(theme: ThemeMode): AppState {
  const today = todayISO();
  const rand = seeded(42);
  const start = addMonths(monthKeyOf(today), -7);
  const startDate = `${start}-01`;

  const courant: Account = { id: uid(), name: 'Compte courant', color: 'violet', initialBalance: 1240, startDate };
  const livret: Account = { id: uid(), name: 'Livret A', color: 'emerald', initialBalance: 6500, startDate };
  const joint: Account = { id: uid(), name: 'Compte joint', color: 'sunset', initialBalance: 820, startDate };

  const recurrings: Recurring[] = [
    { id: uid(), accountId: courant.id, type: 'income', amount: 2450, label: 'Salaire', category: 'salaire', day: 5, startMonth: start, endMonth: null, skipped: [] },
    { id: uid(), accountId: courant.id, type: 'expense', amount: 780, label: 'Loyer', category: 'loyer', day: 3, startMonth: start, endMonth: null, skipped: [] },
    { id: uid(), accountId: courant.id, type: 'expense', amount: 150, label: 'Virement Livret A', category: 'epargne', day: 10, startMonth: start, endMonth: null, skipped: [] },
    { id: uid(), accountId: livret.id, type: 'income', amount: 150, label: 'Virement mensuel', category: 'virement', day: 10, startMonth: start, endMonth: null, skipped: [] },
    { id: uid(), accountId: joint.id, type: 'income', amount: 600, label: 'Alimentation commune', category: 'virement', day: 6, startMonth: start, endMonth: null, skipped: [] },
  ];

  const transactions: Transaction[] = [];
  const add = (accountId: string, type: Transaction['type'], amount: number, date: string, label: string, category: string) =>
    transactions.push({ id: uid(), accountId, type, amount: Math.round(amount * 100) / 100, date, label, category });

  const templates: [string, string, number, number][] = [
    ['Supermarché', 'courses', 25, 95],
    ['Boulangerie', 'courses', 3, 12],
    ['Restaurant', 'restaurant', 18, 65],
    ['Essence', 'carburant', 40, 75],
    ['Cinéma', 'loisirs', 9, 24],
    ['Pharmacie', 'sante', 6, 35],
    ['Vêtements', 'shopping', 30, 120],
  ];

  const end = parseISO(today);
  for (let d = parseISO(startDate); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = isoOf(d.getFullYear(), d.getMonth(), d.getDate());
    const count = rand() < 0.55 ? (rand() < 0.3 ? 2 : 1) : 0;
    for (let i = 0; i < count; i++) {
      const [label, cat, min, max] = templates[Math.floor(rand() * templates.length)];
      add(courant.id, 'expense', min + rand() * (max - min), iso, label, cat);
    }
    if (d.getDate() === 12) add(courant.id, 'expense', 13.49, iso, 'Netflix', 'abonnements');
    if (d.getDate() === 18) add(courant.id, 'expense', 29.99, iso, 'Forfait mobile', 'abonnements');
    if (d.getDay() === 6 && rand() < 0.6) add(joint.id, 'expense', 60 + rand() * 90, iso, 'Courses de la semaine', 'courses');
    if (d.getDate() === 22 && rand() < 0.5) add(joint.id, 'expense', 40 + rand() * 80, iso, 'Sortie', 'restaurant');
    if (d.getDate() === 15 && rand() < 0.35) add(courant.id, 'income', 30 + rand() * 120, iso, 'Remboursement', 'remboursement');
    if (d.getDate() === 20 && rand() < 0.7) add(courant.id, 'expense', 25 + rand() * 30, iso, 'Coiffeur', 'beaute');
    if (d.getDate() === 24 && rand() < 0.5) add(courant.id, 'income', 15 + rand() * 40, iso, 'Remboursement CPAM', 'sante');
  }
  const bonusMonth = addMonths(monthKeyOf(today), -3);
  add(courant.id, 'income', 850, `${bonusMonth}-20`, 'Prime de performance', 'prime');
  add(courant.id, 'expense', 640, `${addMonths(monthKeyOf(today), -2)}-08`, 'Week-end à Lisbonne', 'voyage');
  add(livret.id, 'income', 97.5, `${addMonths(monthKeyOf(today), -5)}-01`, 'Intérêts annuels', 'interets');

  // Un exemple de groupe : le repas avancé pour la tablée, remboursé deux jours plus tard.
  const repasMonth = addMonths(monthKeyOf(today), -1);
  const groupId = uid();
  const repas: Transaction = {
    id: uid(), accountId: courant.id, type: 'expense', amount: 96, date: `${repasMonth}-14`,
    label: 'Restaurant (payé pour tous)', category: 'restaurant', groupId,
  };
  const remboursements: Transaction[] = [
    { id: uid(), accountId: courant.id, type: 'income', amount: 32, date: `${repasMonth}-16`, label: 'Remboursement Léa', category: 'remboursement', groupId },
    { id: uid(), accountId: courant.id, type: 'income', amount: 32, date: `${repasMonth}-16`, label: 'Remboursement Sam', category: 'remboursement', groupId },
  ];
  transactions.push(repas, ...remboursements);

  return {
    version: 1,
    accounts: [courant, livret, joint],
    transactions,
    recurrings,
    theme,
    period: { kind: 'calendar' },
    primaryId: courant.id,
    categories: [],
    groups: [{ id: groupId, label: 'Restaurant entre amis', leadId: repas.id }],
  };
}
