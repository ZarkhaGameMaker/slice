import { daysInMonth, isoOf } from './dates';
import { round2 } from './format';

/** Texte sans accents, en minuscules et espaces simples : pour comparer libellés et en-têtes. */
export const normalizeText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const headerKey = (s: string) => normalizeText(s).replace(/[^a-z0-9]/g, '');

/** Décode un fichier : UTF-8 s'il est valide (BOM retiré), sinon Windows-1252 (exports Excel, banques). */
export function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text.replace(/^﻿/, '');
}

/** Lecture CSV (guillemets, "" échappés, retours à la ligne dans les champs). Lignes vides ignorées. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && field.trim() === '') {
      quoted = true;
      field = '';
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/** Séparateur qui donne le plus de lignes au même nombre (> 1) de colonnes. */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 30).join('\n');
  let best = ';';
  let bestScore = -1;
  for (const d of [';', ',', '\t', '|']) {
    const lengths = parseCsv(sample, d).map((r) => r.length).filter((n) => n > 1);
    const counts = new Map<number, number>();
    for (const n of lengths) counts.set(n, (counts.get(n) ?? 0) + 1);
    for (const [len, count] of counts) {
      const score = count * len;
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
  }
  return best;
}

/** Date bancaire → YYYY-MM-DD. Accepte AAAA-MM-JJ, JJ/MM/AAAA, JJ/MM/AA (séparateurs / - .). */
export function parseBankDate(raw: string): string | null {
  const s = raw.trim();
  const build = (y: number, m: number, d: number) =>
    m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m - 1) ? isoOf(y, m - 1, d) : null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/.exec(s);
  if (m) return build(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\D|$)/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return build(y, +m[2], +m[1]);
  }
  return null;
}

/**
 * Montant bancaire → nombre signé. Gère « -1 234,56 », « 1.234,56 », « 1,234.56 », « +3,00 € »,
 * « (12,00) » et « 12,00- ». Renvoie NaN si illisible.
 */
export function parseBankAmount(raw: string): number {
  let s = raw.replace(/[\s  €]|EUR/gi, '');
  if (!s) return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Le dernier séparateur est la décimale, l'autre sépare les milliers.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (s.split('.').length > 2) {
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = round2(parseFloat(s));
  return negative ? -n : n;
}

export type ColumnRole =
  | 'date'
  | 'label'
  | 'amount'
  | 'debit'
  | 'credit'
  | 'category'
  | 'categoryParent'
  | 'supplier'
  | 'account'
  | 'accountLabel';

/** Index de colonne par rôle (-1 = absente). */
export type ColumnMap = Record<ColumnRole, number>;

// Noms d'en-têtes reconnus (normalisés, sans espaces ni ponctuation), par ordre de préférence.
const ALIASES: Record<ColumnRole, string[]> = {
  date: ['dateop', 'dateoperation', 'datedoperation', 'dateope', 'datecomptable', 'bookingdate', 'date'],
  label: ['label', 'libelle', 'libelleoperation', 'libellesimplifie', 'intitule', 'description', 'detail', 'operation'],
  amount: ['amount', 'montant', 'montanteur', 'montanteuros', 'montanteneur', 'somme'],
  debit: ['debit', 'debiteur', 'debiteuros', 'sortie', 'sorties'],
  credit: ['credit', 'crediteuros', 'entree', 'entrees'],
  category: ['category', 'categorie', 'souscategorie'],
  categoryParent: ['categoryparent', 'categorieparente', 'categorieprincipale'],
  supplier: ['supplierfound', 'marchand', 'commercant', 'tiers', 'beneficiaire'],
  account: ['accountnum', 'numerodecompte', 'numerocompte', 'nocompte', 'iban'],
  accountLabel: ['accountlabel', 'libellecompte', 'nomducompte', 'compte'],
};

export const NO_COLUMNS: ColumnMap = {
  date: -1,
  label: -1,
  amount: -1,
  debit: -1,
  credit: -1,
  category: -1,
  categoryParent: -1,
  supplier: -1,
  account: -1,
  accountLabel: -1,
};

function columnsFromHeader(header: string[]): ColumnMap {
  const keys = header.map(headerKey);
  const map = { ...NO_COLUMNS };
  const used = new Set<number>();
  for (const role of Object.keys(ALIASES) as ColumnRole[]) {
    for (const alias of ALIASES[role]) {
      const idx = keys.findIndex((k, i) => k === alias && !used.has(i));
      if (idx >= 0) {
        map[role] = idx;
        used.add(idx);
        break;
      }
    }
  }
  return map;
}

export const hasEssentialColumns = (c: ColumnMap) =>
  c.date >= 0 && c.label >= 0 && (c.amount >= 0 || c.debit >= 0 || c.credit >= 0);

/** Sans en-tête reconnu : on devine les colonnes d'après leur contenu. */
function guessColumns(rows: string[][]): ColumnMap {
  const sample = rows.slice(0, 50);
  const width = Math.max(0, ...sample.map((r) => r.length));
  const share = (test: (v: string) => boolean, col: number) =>
    sample.filter((r) => r[col] !== undefined && r[col].trim() !== '' && test(r[col])).length / (sample.length || 1);
  const map = { ...NO_COLUMNS };
  let bestDate = 0;
  for (let c = 0; c < width; c++) {
    const s = share((v) => parseBankDate(v) !== null, c);
    if (s > bestDate + 0.001) {
      bestDate = s;
      map.date = c;
    }
  }
  let bestAmount = 0;
  for (let c = 0; c < width; c++) {
    if (c === map.date) continue;
    // Un montant a (presque toujours) une décimale ou un signe : on évite les colonnes d'identifiants.
    const s = share((v) => !Number.isNaN(parseBankAmount(v)) && /[.,-]/.test(v), c);
    if (s > bestAmount + 0.001) {
      bestAmount = s;
      map.amount = c;
    }
  }
  let bestText = 0;
  for (let c = 0; c < width; c++) {
    if (c === map.date || c === map.amount) continue;
    const avg = sample.reduce((n, r) => n + (r[c]?.trim().length ?? 0), 0) / (sample.length || 1);
    if (avg > bestText) {
      bestText = avg;
      map.label = c;
    }
  }
  return map;
}

export interface CsvTable {
  /** En-têtes (générés « Colonne n » si le fichier n'en a pas). */
  headers: string[];
  /** Lignes de données, après l'en-tête. */
  rows: string[][];
  columns: ColumnMap;
  format: 'boursobank' | 'generic';
}

/** Lit un relevé bancaire CSV : séparateur, ligne d'en-tête (éventuellement après des lignes d'infos), colonnes. */
export function readBankCsv(text: string): CsvTable {
  const delimiter = detectDelimiter(text);
  const all = parseCsv(text, delimiter);
  let headerIndex = -1;
  let columns = { ...NO_COLUMNS };
  for (let i = 0; i < Math.min(all.length, 20); i++) {
    const c = columnsFromHeader(all[i]);
    if (hasEssentialColumns(c)) {
      headerIndex = i;
      columns = c;
      break;
    }
  }
  const rows = all.slice(headerIndex + 1);
  const width = Math.max(0, ...all.map((r) => r.length));
  const headers =
    headerIndex >= 0
      ? all[headerIndex].map((h, i) => h.trim() || `Colonne ${i + 1}`)
      : Array.from({ length: width }, (_, i) => `Colonne ${i + 1}`);
  if (headerIndex < 0) columns = guessColumns(rows);
  const keys = headerIndex >= 0 ? all[headerIndex].map(headerKey) : [];
  const format =
    keys.includes('dateop') && (keys.includes('supplierfound') || keys.includes('categoryparent') || keys.includes('accountnum'))
      ? 'boursobank'
      : 'generic';
  return { headers, rows, columns, format };
}
