import { normalizeText, parseBankAmount, parseBankDate, type ColumnMap, type CsvTable } from './csv';
import { addMonths, monthKeyOf, parseISO, toISO } from './dates';
import { expandRecurring } from './finance';
import type { Account, Recurring, Transaction, TxType } from './types';

/** Une ligne du relevé, interprétée. */
export interface ImportRow {
  /** Position dans le relevé (1 = première opération). */
  line: number;
  date: string | null;
  /** Libellé tel qu'écrit par la banque (sert à reconnaître la ligne lors d'un prochain import). */
  rawLabel: string;
  /** Libellé nettoyé proposé. */
  label: string;
  /** Montant signé : négatif = dépense. */
  amount: number;
  type: TxType;
  category: string;
  /** Compte bancaire indiqué dans le fichier ('' si le fichier n'en précise pas). */
  bankAccount: string;
  /** Nom lisible de ce compte (libellé et fin du numéro). */
  bankAccountName: string;
  error?: string;
}

// Mots-clés (sans accents) → catégorie, testés dans l'ordre sur catégorie banque + libellé.
const EXPENSE_RULES: [string, string[]][] = [
  ['loyer', ['loyer']],
  ['beaute', ['coiffeur', 'coiffure', 'cosmetique', 'beaute', 'esthetique', 'barbier']],
  ['sante', ['sante', 'pharmacie', 'medecin', 'medical', 'dentiste', 'optique', 'opticien', 'mutuelle', 'hopital', 'kine']],
  ['courses', ['alimentation', 'supermarche', 'hypermarche', 'courses', 'epicerie', 'boulangerie', 'carrefour', 'leclerc', 'auchan', 'lidl', 'intermarche', 'monoprix', 'franprix', 'casino', 'picard', 'biocoop', 'aldi', 'super u', 'hyper u']],
  ['restaurant', ['restaurant', 'restauration', 'bar', 'cafe', 'fast food', 'mcdonald', 'burger', 'uber eats', 'deliveroo', 'just eat', 'brasserie', 'pizzeria', 'sushi']],
  ['abonnements', ['abonnement', 'telephon', 'internet', 'mobile', 'netflix', 'spotify', 'deezer', 'disney', 'canal', 'free mobile', 'sfr', 'bouygues', 'orange', 'sosh', 'box', 'amazon prime', 'apple.com', 'google']],
  ['carburant', ['carburant', 'essence', 'gazole', 'gasoil', 'diesel', 'sp95', 'sp98', 'station service', 'station-service', 'total energies', 'totalenergies', 'station u', 'esso', 'avia', 'shell']],
  ['transport', ['peage', 'parking', 'transport', 'sncf', 'ratp', 'navigo', 'uber', 'bolt', 'taxi', 'train', 'vehicule', 'automobile', 'garage', 'autoroute', 'station']],
  ['voyage', ['voyage', 'vacances', 'hotel', 'airbnb', 'booking', 'avion', 'compagnie aerienne', 'air france', 'easyjet', 'ryanair']],
  ['logement', ['logement', 'charges', 'electricite', 'energie', 'gaz', 'eau', 'assurance habitation', 'edf', 'engie', 'travaux', 'bricolage', 'leroy merlin', 'castorama', 'ikea', 'ameublement', 'syndic']],
  ['loisirs', ['loisir', 'cinema', 'sport', 'culture', 'spectacle', 'concert', 'jeux', 'musee', 'sortie', 'livre', 'fnac', 'decathlon']],
  ['shopping', ['shopping', 'vetement', 'habillement', 'chaussure', 'mode', 'amazon', 'zara', 'cadeau', 'high-tech', 'electronique', 'achat']],
  ['epargne', ['epargne', 'livret', 'placement', 'assurance vie', 'bourse']],
  ['virement', ['virement', 'vir sepa', 'mouvements internes']],
];

const INCOME_RULES: [string, string[]][] = [
  ['salaire', ['salaire', 'paie', 'remuneration', 'traitement']],
  ['prime', ['prime', 'bonus', 'interessement', 'participation']],
  ['loyer', ['loyer']],
  ['sante', ['cpam', 'ameli', 'assurance maladie', 'mutuelle', 'remboursement sante', 'sante']],
  ['interets', ['interet']],
  ['remboursement', ['rembours', 'avoir', 'annulation']],
  ['cadeau', ['cadeau', 'don']],
  ['vente', ['vente', 'leboncoin', 'vinted']],
  ['virement', ['virement', 'vir', 'mouvements internes']],
];

// Mots courts (« bar », « eau », « box »…) : mot entier seulement, sinon « bureau » serait du logement.
const matches = (text: string, word: string) =>
  word.length <= 4 ? new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text) : text.includes(word);

/** Devine la catégorie d'après la catégorie de la banque et le libellé. */
export function guessCategory(type: TxType, text: string): string {
  const t = normalizeText(text);
  const rules = type === 'income' ? INCOME_RULES : EXPENSE_RULES;
  for (const [id, words] of rules) if (words.some((w) => matches(t, w))) return id;
  return 'autre';
}

const titleCase = (s: string) =>
  s === s.toUpperCase() || s === s.toLowerCase()
    ? s.toLowerCase().replace(/(^|[\s'’(-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    : s;

/** « CARTE 13/09/26 CARREFOUR CB*1234 » → « Carrefour » ; utilise le marchand détecté s'il existe. */
export function cleanLabel(raw: string, supplier = ''): string {
  const pick = supplier.trim().length >= 2 ? supplier.trim() : raw.trim();
  const transfer = /^(VIR|VIREMENT)\s+(SEPA\s+|INST(ANTANE)?\s+|PERMANENT\s+)?(RECU\s+|REÇU\s+|EMIS\s+|ÉMIS\s+)?/i;
  const isTransfer = pick === raw.trim() && transfer.test(pick);
  const rest = pick
    .replace(transfer, '')
    .replace(/^(CARTE|CB)\s+\d{2}\/\d{2}(\/\d{2,4})?\s*/i, '')
    .replace(/\s*CB\*\s*\d{4}.*$/i, '')
    .replace(/^(PRLV|PRELEVEMENT|PRÉLÈVEMENT)\s+(SEPA\s+)?/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const label = rest ? titleCase(rest) : titleCase(pick);
  const alreadySaysIt = normalizeText(rest).startsWith('virement');
  return (isTransfer && rest && !alreadySaysIt ? `Virement ${label}` : label).slice(0, 60);
}

const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');

const accountName = (label: string, num: string) => {
  const end = num.length > 4 ? `…${num.slice(-4)}` : num;
  return [label, end].filter(Boolean).join(' · ');
};

/** Interprète les lignes du relevé selon la correspondance des colonnes. */
export function extractRows(table: CsvTable, columns: ColumnMap): ImportRow[] {
  return table.rows.map((row, i) => {
    const date = parseBankDate(cell(row, columns.date));
    let amount: number;
    if (columns.amount >= 0) amount = parseBankAmount(cell(row, columns.amount));
    else {
      const debit = parseBankAmount(cell(row, columns.debit));
      const credit = parseBankAmount(cell(row, columns.credit));
      amount = Number.isNaN(debit) && Number.isNaN(credit)
        ? NaN
        : Math.round(((Number.isNaN(credit) ? 0 : Math.abs(credit)) - (Number.isNaN(debit) ? 0 : Math.abs(debit))) * 100) / 100;
    }
    const supplier = cell(row, columns.supplier);
    const rawLabel = cell(row, columns.label) || supplier;
    const type: TxType = amount > 0 ? 'income' : 'expense';
    const bankText = [cell(row, columns.category), cell(row, columns.categoryParent), rawLabel, supplier].join(' ');
    const error = !date
      ? 'Date illisible'
      : Number.isNaN(amount)
        ? 'Montant illisible'
        : amount === 0
          ? 'Montant nul'
          : !rawLabel
            ? 'Libellé vide'
            : undefined;
    return {
      line: i + 1,
      date,
      rawLabel,
      label: cleanLabel(rawLabel, supplier),
      amount: Number.isNaN(amount) ? 0 : amount,
      type,
      category: guessCategory(type, bankText),
      bankAccount: cell(row, columns.account) || cell(row, columns.accountLabel),
      bankAccountName: accountName(cell(row, columns.accountLabel), cell(row, columns.account)),
      error,
    };
  });
}

/**
 * - new : nouvelle opération ;
 * - imported : déjà importée (même empreinte) — jamais réimportée ;
 * - recurring : correspond à une échéance automatique, qu'elle remplacera ;
 * - duplicate : ressemble à une opération déjà saisie (même montant, date proche) — décochée par défaut ;
 * - ignored : le compte du fichier n'est associé à aucun compte ;
 * - error : ligne illisible.
 */
export type RowStatus = 'new' | 'imported' | 'recurring' | 'duplicate' | 'ignored' | 'error';

export interface AnalyzedRow extends ImportRow {
  status: RowStatus;
  /** Empreinte stockée sur l'opération importée : date | centimes | libellé banque # rang. */
  key: string;
  accountId: string | null;
  /** Explication affichée (opération ou règle correspondante). */
  match?: string;
  /** Échéance automatique à ignorer si la ligne est importée. */
  skip?: { id: string; month: string };
  /** Compte de l'app où cette ligne a déjà été importée, s'il diffère du compte choisi. */
  elsewhere?: string;
}

export const importKey = (date: string, cents: number, rawLabel: string, rank: number) =>
  `${date}|${cents}|${normalizeText(rawLabel)}#${rank}`;

const dayGap = (a: string, b: string) => Math.abs(parseISO(a).getTime() - parseISO(b).getTime()) / 86_400_000;
const cents = (n: number) => Math.round(n * 100);
const shiftDate = (iso: string, days: number) => {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
};

/** Tolérance de date pour rapprocher une ligne d'une opération existante ou d'une échéance. */
const DUPLICATE_DAYS = 3;
const RECURRING_DAYS = 4;

interface ExistingData {
  transactions: Transaction[];
  recurrings: Recurring[];
}

/** Classe chaque ligne : nouvelle, déjà importée, doublon probable, remplaçante d'une échéance… */
export function analyzeImport(rows: ImportRow[], targets: Record<string, string>, data: ExistingData): AnalyzedRow[] {
  const valid = rows.filter((r) => !r.error && r.date);
  const dates = valid.map((r) => r.date!).sort();
  const lastMonth = dates.length ? monthKeyOf(dates[dates.length - 1]) : '';

  // Rang des lignes identiques (même compte, date, montant, libellé) : deux cafés identiques restent deux opérations.
  const ranks = new Map<string, number>();
  const withKeys = rows.map((r) => {
    const accountId = targets[r.bankAccount] || null;
    if (r.error || !r.date) return { ...r, accountId, key: '', status: 'error' as RowStatus };
    if (!accountId) return { ...r, accountId, key: '', status: 'ignored' as RowStatus };
    const base = `${accountId}|${r.date}|${cents(r.amount)}|${normalizeText(r.rawLabel)}`;
    const rank = ranks.get(base) ?? 0;
    ranks.set(base, rank + 1);
    return { ...r, accountId, key: importKey(r.date, cents(r.amount), r.rawLabel, rank), status: 'new' as RowStatus };
  });

  const consumed = new Set<string>();
  const byKey = new Map<string, Transaction>();
  const byKeyAnywhere = new Map<string, Transaction>();
  for (const t of data.transactions) {
    if (!t.importKey) continue;
    byKey.set(`${t.accountId}|${t.importKey}`, t);
    if (!byKeyAnywhere.has(t.importKey)) byKeyAnywhere.set(t.importKey, t);
  }

  // 1. Empreintes identiques : déjà importées.
  const out: AnalyzedRow[] = withKeys.map((r) => {
    if (r.status !== 'new') return r;
    const existing = byKey.get(`${r.accountId}|${r.key}`);
    if (!existing) {
      // Déjà importée… mais dans un autre compte : sans doute un mauvais compte choisi.
      const other = byKeyAnywhere.get(r.key);
      return other ? { ...r, status: 'duplicate', match: other.label, elsewhere: other.accountId } : r;
    }
    consumed.add(existing.id);
    return { ...r, status: 'imported', match: existing.label };
  });

  // Échéances automatiques des comptes concernés, sur la période du relevé (± la tolérance).
  const from = dates.length ? shiftDate(dates[0], -RECURRING_DAYS) : '';
  const to = dates.length ? shiftDate(dates[dates.length - 1], RECURRING_DAYS) : '';
  const occurrences = lastMonth
    ? data.recurrings
        .filter((rule) => Object.values(targets).includes(rule.accountId))
        .flatMap((rule) =>
          expandRecurring(rule, addMonths(lastMonth, 1))
            .filter((e) => e.date >= from && e.date <= to)
            .map((e) => ({ ...e, rule })),
        )
    : [];
  const usedOccurrences = new Set<string>();

  for (const r of out) {
    if (r.status !== 'new' || !r.date) continue;
    const amountCents = cents(Math.abs(r.amount));
    const text = normalizeText(r.rawLabel);

    // 2. Échéance automatique : même montant, ou montant proche avec un mot du libellé de la règle.
    const occ = occurrences.find((e) => {
      if (usedOccurrences.has(e.id) || e.accountId !== r.accountId || e.type !== r.type) return false;
      if (dayGap(e.date, r.date!) > RECURRING_DAYS) return false;
      if (cents(e.amount) === amountCents) return true;
      const close = Math.abs(e.amount - Math.abs(r.amount)) <= e.amount * 0.1;
      const words = normalizeText(e.rule.label).split(' ').filter((w) => w.length >= 3);
      return close && words.some((w) => text.includes(w));
    });
    if (occ) {
      usedOccurrences.add(occ.id);
      r.status = 'recurring';
      r.match = occ.rule.label;
      r.skip = { id: occ.rule.id, month: occ.monthKey! };
      continue;
    }

    // 3. Opération existante qui y ressemble fort : même montant, date proche pour une saisie
    //    manuelle, même jour pour une ligne déjà importée (la banque a pu changer son libellé).
    const twin = data.transactions.find(
      (t) =>
        !consumed.has(t.id) &&
        t.accountId === r.accountId &&
        t.type === r.type &&
        cents(t.amount) === amountCents &&
        (t.importKey ? t.date === r.date : dayGap(t.date, r.date!) <= DUPLICATE_DAYS),
    );
    if (twin) {
      consumed.add(twin.id);
      r.status = 'duplicate';
      r.match = `${twin.label} (${twin.date.split('-').reverse().join('/')})`;
    }
  }
  return out;
}

/**
 * Compte de destination proposé pour chaque compte du relevé, par ordre de confiance :
 * compte qui contient déjà des lignes de ce relevé (la preuve la plus sûre contre les doublons),
 * compte lié à ce numéro lors d'un import précédent, compte du même nom,
 * puis `fallback` pour le premier compte du fichier.
 */
export function suggestTargets(
  rows: ImportRow[],
  accounts: Account[],
  transactions: Transaction[],
  fallback: string,
): Record<string, string> {
  const owner = new Map<string, string>();
  for (const t of transactions) if (t.importKey && !owner.has(t.importKey)) owner.set(t.importKey, t.accountId);
  const banks = [...new Set(rows.filter((r) => !r.error).map((r) => r.bankAccount))];
  const out: Record<string, string> = {};
  banks.forEach((bank, i) => {
    const votes = new Map<string, number>();
    const ranks = new Map<string, number>();
    for (const r of rows) {
      if (r.error || !r.date || r.bankAccount !== bank) continue;
      const base = `${r.date}|${cents(r.amount)}|${normalizeText(r.rawLabel)}`;
      const rank = ranks.get(base) ?? 0;
      ranks.set(base, rank + 1);
      const acc = owner.get(importKey(r.date, cents(r.amount), r.rawLabel, rank));
      if (acc) votes.set(acc, (votes.get(acc) ?? 0) + 1);
    }
    const best = [...votes].sort((a, b) => b[1] - a[1])[0];
    if (best) return void (out[bank] = best[0]);

    const linked = bank ? accounts.find((a) => a.bankRefs?.includes(bank)) : undefined;
    if (linked) return void (out[bank] = linked.id);

    const name = normalizeText(rows.find((r) => r.bankAccount === bank)?.bankAccountName.split(' · ')[0] ?? '');
    const sameName = name ? accounts.find((a) => normalizeText(a.name) === name) : undefined;
    out[bank] = sameName?.id ?? (i === 0 ? fallback : '');
  });
  return out;
}

/** Cochée par défaut : nouvelles opérations et remplaçantes d'échéances. */
export const checkedByDefault = (r: AnalyzedRow) => r.status === 'new' || r.status === 'recurring';

/** Peut être importée si l'utilisateur la coche. */
export const selectable = (r: AnalyzedRow) => r.status === 'new' || r.status === 'recurring' || r.status === 'duplicate';

/** Opérations à créer et échéances à ignorer pour les lignes retenues. */
export function buildImport(
  rows: AnalyzedRow[],
  makeId: () => string,
  categoryOf: (r: AnalyzedRow) => string = (r) => r.category,
) {
  const transactions: Transaction[] = [];
  const skips: { id: string; month: string }[] = [];
  for (const r of rows) {
    if (!r.accountId || !r.date || !selectable(r)) continue;
    transactions.push({
      id: makeId(),
      accountId: r.accountId,
      type: r.type,
      amount: Math.abs(r.amount),
      date: r.date,
      label: r.label,
      category: categoryOf(r),
      importKey: r.key,
    });
    if (r.skip) skips.push(r.skip);
  }
  return { transactions, skips };
}
