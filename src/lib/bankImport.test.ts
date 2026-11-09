import { describe, expect, it } from 'vitest';
import {
  analyzeImport,
  buildImport,
  checkedByDefault,
  cleanLabel,
  extractRows,
  guessCategory,
  suggestTargets,
  type AnalyzedRow,
} from './bankImport';
import { decodeText, detectDelimiter, parseBankAmount, parseBankDate, parseCsv, readBankCsv } from './csv';
import type { Account, Recurring, Transaction } from './types';

// Relevé au format de l'export BoursoBank (séparateur ;, dates ISO, virgule décimale).
const BOURSO = [
  'dateOp;dateVal;label;category;categoryParent;supplierFound;amount;comment;accountNum;accountLabel;accountbalance',
  '2025-09-15;2025-09-15;"CARTE 13/09/25 CARREFOUR CB*1234";"Alimentation";"Vie quotidienne";"carrefour";-45,67;;00040123456;"BoursoBank";1234.56',
  '2025-09-05;2025-09-05;"VIR SEPA ACME SALAIRE SEPTEMBRE";"Salaires";"Revenus et rentrées d\'argent";"";2 450,00;;00040123456;"BoursoBank";1280.23',
  '2025-09-12;2025-09-12;"PRLV SEPA NETFLIX.COM";"Abonnements";"Loisirs et sorties";"netflix";-13,49;;00040123456;"BoursoBank";1293.72',
  '2025-09-11;2025-09-11;"CARTE 10/09/25 BOULANGERIE CB*1234";"Alimentation";"Vie quotidienne";"";-2,10;;00040123456;"BoursoBank";1307.21',
  '2025-09-11;2025-09-11;"CARTE 10/09/25 BOULANGERIE CB*1234";"Alimentation";"Vie quotidienne";"";-2,10;;00040123456;"BoursoBank";1309.31',
  '2025-09-08;2025-09-08;"CARTE 06/09/25 PHARMACIE DU CENTRE CB*1234";"Pharmacie";"Santé";"";-18,00;;00040123456;"BoursoBank";1311.41',
].join('\r\n');

const salary: Recurring = {
  id: 'rule-salaire',
  accountId: 'acc',
  type: 'income',
  amount: 2450,
  label: 'Salaire',
  category: 'salaire',
  day: 5,
  startMonth: '2025-01',
  endMonth: null,
  skipped: [],
};

let seq = 0;
const makeId = () => `tx-${++seq}`;

describe('lecture CSV', () => {
  it('reconnaît le séparateur et les guillemets', () => {
    expect(detectDelimiter(BOURSO)).toBe(';');
    expect(parseCsv('a;"b;c";"d ""e"""\n1;2;3', ';')).toEqual([
      ['a', 'b;c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });

  it('détecte le format BoursoBank et ses colonnes', () => {
    const table = readBankCsv(BOURSO);
    expect(table.format).toBe('boursobank');
    expect(table.rows).toHaveLength(6);
    expect(table.columns.date).toBe(0);
    expect(table.columns.label).toBe(2);
    expect(table.columns.amount).toBe(6);
    expect(table.columns.account).toBe(8);
  });

  it('lit les montants français et anglais', () => {
    expect(parseBankAmount('-45,67')).toBe(-45.67);
    expect(parseBankAmount('2 450,00')).toBe(2450);
    expect(parseBankAmount('1.234,56')).toBe(1234.56);
    expect(parseBankAmount('1,234.56')).toBe(1234.56);
    expect(parseBankAmount('+3,00 €')).toBe(3);
    expect(parseBankAmount('(12,00)')).toBe(-12);
    expect(parseBankAmount('12,00-')).toBe(-12);
    expect(parseBankAmount('abc')).toBeNaN();
  });

  it('lit les dates ISO et françaises', () => {
    expect(parseBankDate('2025-09-15')).toBe('2025-09-15');
    expect(parseBankDate('15/09/2025')).toBe('2025-09-15');
    expect(parseBankDate('15/09/25')).toBe('2025-09-15');
    expect(parseBankDate('2025-09-15 00:00:00')).toBe('2025-09-15');
    expect(parseBankDate('31/02/2025')).toBeNull();
  });

  it('décode un fichier Windows-1252', () => {
    const bytes = new Uint8Array([0x4c, 0x69, 0x62, 0x65, 0x6c, 0x6c, 0xe9]); // « Libellé » en latin-1
    expect(decodeText(bytes.buffer)).toBe('Libellé');
  });

  it('gère un relevé générique avec débit / crédit et lignes d\'en-tête', () => {
    const csv = [
      'Compte courant n°123',
      '',
      'Date;Libellé;Débit;Crédit',
      '02/09/2025;LOYER SEPTEMBRE;780,00;',
      '03/09/2025;REMBOURSEMENT CPAM;;25,50',
    ].join('\n');
    const table = readBankCsv(csv);
    expect(table.format).toBe('generic');
    const rows = extractRows(table, table.columns);
    expect(rows.map((r) => [r.date, r.amount, r.category])).toEqual([
      ['2025-09-02', -780, 'loyer'],
      ['2025-09-03', 25.5, 'sante'],
    ]);
  });
});

describe('libellés et catégories', () => {
  it('nettoie les libellés bancaires', () => {
    expect(cleanLabel('CARTE 13/09/25 CARREFOUR CB*1234')).toBe('Carrefour');
    expect(cleanLabel('CARTE 13/09/25 CARREFOUR CB*1234', 'carrefour')).toBe('Carrefour');
    expect(cleanLabel('PRLV SEPA NETFLIX.COM')).toBe('Netflix.com');
    expect(cleanLabel('VIR SEPA ACME SALAIRE SEPTEMBRE')).toBe('Virement Acme Salaire Septembre');
  });

  it('devine les catégories', () => {
    expect(guessCategory('expense', 'Alimentation Vie quotidienne')).toBe('courses');
    expect(guessCategory('expense', 'Abonnements PRLV NETFLIX')).toBe('abonnements');
    expect(guessCategory('expense', 'Coiffeur, cosmétique, soins')).toBe('beaute');
    expect(guessCategory('income', 'Salaires VIR SEPA ACME')).toBe('salaire');
    expect(guessCategory('expense', 'XYZ')).toBe('autre');
    // Le carburant a sa propre catégorie, le reste de la voiture reste dans transport.
    expect(guessCategory('expense', 'CARTE TOTAL ENERGIES CB*1234')).toBe('carburant');
    expect(guessCategory('expense', 'CARTE 12/09 ESSENCE STATION SERVICE')).toBe('carburant');
    expect(guessCategory('expense', 'PEAGE AUTOROUTE APRR')).toBe('transport');
    // « Virement » passe après les catégories plus précises : VIR SEPA LOYER reste un loyer.
    expect(guessCategory('expense', 'VIR SEPA M DUPONT')).toBe('virement');
    expect(guessCategory('expense', 'VIR SEPA LOYER AOUT')).toBe('loyer');
  });
});

describe('import sans doublons', () => {
  const table = readBankCsv(BOURSO);
  const rows = extractRows(table, table.columns);
  const targets = { '00040123456': 'acc' };

  const statuses = (list: AnalyzedRow[]) => list.map((r) => `${r.label}:${r.status}`);

  it('premier import : tout est nouveau, le salaire remplace l\'échéance automatique', () => {
    const analyzed = analyzeImport(rows, targets, { transactions: [], recurrings: [salary] });
    expect(statuses(analyzed)).toEqual([
      'Carrefour:new',
      'Virement Acme Salaire Septembre:recurring',
      'Netflix:new',
      'Boulangerie:new',
      'Boulangerie:new',
      'Pharmacie Du Centre:new',
    ]);
    const salaryRow = analyzed[1];
    expect(salaryRow.skip).toEqual({ id: 'rule-salaire', month: '2025-09' });
    // Les deux baguettes identiques restent deux opérations distinctes.
    expect(analyzed[3].key).not.toBe(analyzed[4].key);
    expect(analyzed.every(checkedByDefault)).toBe(true);
  });

  it('second import du même relevé : rien n\'est ajouté', () => {
    const first = analyzeImport(rows, targets, { transactions: [], recurrings: [salary] });
    const { transactions, skips } = buildImport(first, makeId);
    expect(transactions).toHaveLength(6);
    expect(skips).toEqual([{ id: 'rule-salaire', month: '2025-09' }]);

    const skippedRule = { ...salary, skipped: ['2025-09'] };
    const second = analyzeImport(rows, targets, { transactions, recurrings: [skippedRule] });
    expect(second.every((r) => r.status === 'imported')).toBe(true);
    expect(buildImport(second.filter(checkedByDefault), makeId).transactions).toHaveLength(0);
  });

  it('relevé qui chevauche le précédent : seules les nouvelles lignes sont ajoutées', () => {
    const { transactions } = buildImport(analyzeImport(rows, targets, { transactions: [], recurrings: [] }), makeId);
    const next = readBankCsv(
      [
        BOURSO.split('\r\n')[0],
        ...BOURSO.split('\r\n').slice(4, 6), // les deux baguettes, déjà importées
        '2025-09-20;2025-09-20;"CARTE 19/09/25 CINEMA CB*1234";"Cinéma";"Loisirs et sorties";"";-11,00;;00040123456;"BoursoBank";0',
      ].join('\n'),
    );
    const analyzed = analyzeImport(extractRows(next, next.columns), targets, { transactions, recurrings: [] });
    expect(analyzed.map((r) => r.status)).toEqual(['imported', 'imported', 'new']);
  });

  it('opération déjà saisie à la main : doublon probable, décochée', () => {
    const manual: Transaction = {
      id: 'm1',
      accountId: 'acc',
      type: 'expense',
      amount: 45.67,
      date: '2025-09-14',
      label: 'Courses',
      category: 'courses',
    };
    const analyzed = analyzeImport(rows, targets, { transactions: [manual], recurrings: [] });
    expect(analyzed[0].status).toBe('duplicate');
    expect(analyzed[0].match).toBe('Courses (14/09/2025)');
    expect(checkedByDefault(analyzed[0])).toBe(false);
  });

  it('compte du fichier non associé : lignes ignorées', () => {
    const analyzed = analyzeImport(rows, {}, { transactions: [], recurrings: [] });
    expect(analyzed.every((r) => r.status === 'ignored')).toBe(true);
    expect(buildImport(analyzed, makeId).transactions).toHaveLength(0);
  });
});

describe('choix du compte de destination', () => {
  const table = readBankCsv(BOURSO);
  const rows = extractRows(table, table.columns);
  const accounts: Account[] = [
    { id: 'joint', name: 'Compte joint', color: 'sunset', initialBalance: 0, startDate: '2025-01-01' },
    { id: 'acc', name: 'Compte courant', color: 'violet', initialBalance: 0, startDate: '2025-01-01' },
  ];

  it('sans indice : le compte proposé par défaut', () => {
    expect(suggestTargets(rows, accounts, [], 'joint')).toEqual({ '00040123456': 'joint' });
  });

  it('numéro de compte déjà lié : ce compte, quel que soit le défaut', () => {
    const linked = [accounts[0], { ...accounts[1], bankRefs: ['00040123456'] }];
    expect(suggestTargets(rows, linked, [], 'joint')).toEqual({ '00040123456': 'acc' });
  });

  it('lignes déjà importées quelque part : ce compte-là', () => {
    const { transactions } = buildImport(
      analyzeImport(rows, { '00040123456': 'acc' }, { transactions: [], recurrings: [] }),
      makeId,
    );
    expect(suggestTargets(rows, accounts, transactions, 'joint')).toEqual({ '00040123456': 'acc' });
  });

  it('lignes déjà importées : elles l’emportent sur un lien vers un autre compte', () => {
    const { transactions } = buildImport(
      analyzeImport(rows, { '00040123456': 'acc' }, { transactions: [], recurrings: [] }),
      makeId,
    );
    const wrongLink = [{ ...accounts[0], bankRefs: ['00040123456'] }, accounts[1]];
    expect(suggestTargets(rows, wrongLink, transactions, 'joint')).toEqual({ '00040123456': 'acc' });
  });

  it('mauvais compte choisi : les lignes déjà importées ailleurs sont des doublons décochés', () => {
    const { transactions } = buildImport(
      analyzeImport(rows, { '00040123456': 'acc' }, { transactions: [], recurrings: [] }),
      makeId,
    );
    const wrong = analyzeImport(rows, { '00040123456': 'joint' }, { transactions, recurrings: [] });
    expect(wrong.every((r) => r.status === 'duplicate' && r.elsewhere === 'acc')).toBe(true);
    expect(wrong.some(checkedByDefault)).toBe(false);
  });
});
