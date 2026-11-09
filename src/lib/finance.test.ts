import { describe, expect, it } from 'vitest';
import {
  buildTimeline,
  categoryAverages,
  expandRecurring,
  groupNet,
  monthIndexOf,
  nextOccurrences,
  ordinaryExpense,
  ordinaryIncome,
  periodDay,
  periodKeyOf,
  periodStartDate,
  recurringDate,
} from './finance';
import type { Account, Recurring, Transaction, TxGroup } from './types';

const dow = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};

describe('recurringDate', () => {
  it('garde le 5 quand c’est un jour de semaine', () => {
    // 5 septembre 2025 = vendredi
    expect(recurringDate(2025, 8, 5)).toBe('2025-09-05');
  });

  it('avance au 4 quand le 5 tombe un samedi', () => {
    // 5 avril 2025 = samedi
    expect(dow('2025-04-05')).toBe(6);
    expect(recurringDate(2025, 3, 5)).toBe('2025-04-04');
  });

  it('reporte au 6 quand le 5 tombe un dimanche', () => {
    // 5 octobre 2025 = dimanche
    expect(dow('2025-10-05')).toBe(0);
    expect(recurringDate(2025, 9, 5)).toBe('2025-10-06');
  });

  it('ramène au dernier jour du mois quand le jour n’existe pas', () => {
    // 28 février 2025 = vendredi
    expect(recurringDate(2025, 1, 31)).toBe('2025-02-28');
  });

  it('reste dans le mois pour un dimanche en fin de mois', () => {
    // 31 août 2025 = dimanche → vendredi 29
    expect(dow('2025-08-31')).toBe(0);
    expect(recurringDate(2025, 7, 31)).toBe('2025-08-29');
  });

  it('reste dans le mois pour un samedi le 1er', () => {
    // 1er novembre 2025 = samedi → lundi 3
    expect(dow('2025-11-01')).toBe(6);
    expect(recurringDate(2025, 10, 1)).toBe('2025-11-03');
  });

  it('ne tombe jamais un week-end', () => {
    for (let y = 2024; y <= 2027; y++)
      for (let m = 0; m < 12; m++)
        for (let d = 1; d <= 31; d++) {
          const iso = recurringDate(y, m, d);
          expect([1, 2, 3, 4, 5]).toContain(dow(iso));
          expect(Number(iso.slice(5, 7))).toBe(m + 1);
        }
  });
});

const salary: Recurring = {
  id: 'r1',
  accountId: 'a1',
  type: 'income',
  amount: 2000,
  label: 'Salaire',
  category: 'salaire',
  day: 5,
  startMonth: '2025-09',
  endMonth: null,
  skipped: ['2025-11'],
};

describe('expandRecurring', () => {
  it('génère un versement par mois en sautant les mois ignorés', () => {
    const dates = expandRecurring(salary, '2025-12').map((e) => e.date);
    expect(dates).toEqual(['2025-09-05', '2025-10-06', '2025-12-05']);
  });

  it('respecte le mois de fin', () => {
    expect(expandRecurring({ ...salary, endMonth: '2025-10' }, '2026-06')).toHaveLength(2);
  });

  it('liste les prochaines dates à partir d’aujourd’hui', () => {
    expect(nextOccurrences(salary, '2025-10-07', 2)).toEqual(['2025-12-05', '2026-01-05']);
  });
});

describe('buildTimeline', () => {
  const account: Account = { id: 'a1', name: 'Courant', color: 'violet', initialBalance: 100, startDate: '2025-09-01' };
  const txs: Transaction[] = [
    { id: 't1', accountId: 'a1', type: 'expense', amount: 30.1, date: '2025-09-02', label: 'Courses', category: 'courses' },
    { id: 't2', accountId: 'a2', type: 'expense', amount: 999, date: '2025-09-02', label: 'Autre compte', category: 'autre' },
  ];

  it('cumule le solde jour après jour et projette le futur', () => {
    const { months, balanceToday } = buildTimeline({
      accounts: [account],
      transactions: txs,
      recurrings: [salary],
      accountIds: ['a1'],
      today: '2025-09-10',
      futureMonths: 1,
    });
    expect(months.map((m) => m.key)).toEqual(['2025-09', '2025-10']);
    const sept = months[0];
    expect(sept.days[0].balance).toBe(100);
    expect(sept.days[1].balance).toBe(69.9);
    expect(sept.days[4].balance).toBe(2069.9);
    expect(sept.expense).toBe(30.1);
    expect(sept.income).toBe(2000);
    expect(sept.days[10].future).toBe(true);
    expect(balanceToday).toBe(2069.9);
    expect(months[1].closingBalance).toBe(4069.9);
  });
});

describe('périodes de paie', () => {
  it('commencent le jour du versement, décalé comme le salaire', () => {
    expect(periodStartDate('2025-09', 5)).toBe('2025-09-05');
    expect(periodStartDate('2025-10', 5)).toBe('2025-10-06'); // le 5 est un dimanche
    expect(periodStartDate('2025-10', null)).toBe('2025-10-01');
  });

  it('rattachent une date à la période en cours', () => {
    expect(periodKeyOf('2025-10-05', 5)).toBe('2025-09');
    expect(periodKeyOf('2025-10-06', 5)).toBe('2025-10');
    expect(periodKeyOf('2025-09-04', 5)).toBe('2025-08');
    expect(periodKeyOf('2025-09-04', null)).toBe('2025-09');
  });

  it('suivent le jour de l’opération automatique choisie', () => {
    expect(periodDay({ kind: 'rule', recurringId: 'r1' }, [salary])).toBe(5);
    expect(periodDay({ kind: 'rule', recurringId: 'absent' }, [salary])).toBeNull();
    expect(periodDay({ kind: 'day', day: 27 }, [])).toBe(27);
    expect(periodDay({ kind: 'calendar' }, [salary])).toBeNull();
  });

  it('découpent le solde de paie à paie, sans trou ni chevauchement', () => {
    const account: Account = { id: 'a1', name: 'Courant', color: 'violet', initialBalance: 100, startDate: '2025-09-01' };
    const txs: Transaction[] = [
      { id: 't1', accountId: 'a1', type: 'expense', amount: 30.1, date: '2025-09-02', label: 'Courses', category: 'courses' },
    ];
    const { months } = buildTimeline({
      accounts: [account],
      transactions: txs,
      recurrings: [{ ...salary, skipped: [] }],
      accountIds: ['a1'],
      today: '2025-09-10',
      futureMonths: 1,
      startDay: 5,
    });
    expect(months.map((m) => [m.key, m.start, m.end])).toEqual([
      ['2025-08', '2025-08-05', '2025-09-04'],
      ['2025-09', '2025-09-05', '2025-10-05'],
      ['2025-10', '2025-10-06', '2025-11-04'],
    ]);
    expect(months[0].expense).toBe(30.1);
    expect(months[1].income).toBe(2000);
    expect(months[1].days).toHaveLength(31);
    expect(months[1].days[0].day).toBe(5);
    expect(months[2].income).toBe(2000);
    expect(months[1].openingBalance).toBe(months[0].closingBalance);
    expect(monthIndexOf(months, '2025-10-05')).toBe(1);
    expect(monthIndexOf(months, '2026-01-01')).toBe(-1);
  });
});

describe('moyenne par mois', () => {
  const account: Account = { id: 'a1', name: 'Courant', color: 'violet', initialBalance: 0, startDate: '2025-06-01' };
  const tx = (id: string, date: string, amount: number, category: string, type: Transaction['type'] = 'expense'): Transaction => ({
    id,
    accountId: 'a1',
    type,
    amount,
    date,
    label: category,
    category,
  });
  // Juin à août terminés, septembre en cours (today = 2025-09-10), octobre à venir.
  const build = (transactions: Transaction[], recurrings: Recurring[] = []) =>
    buildTimeline({ accounts: [account], transactions, recurrings, accountIds: ['a1'], today: '2025-09-10', futureMonths: 1 }).months;

  const base = [
    tx('t1', '2025-06-12', 100, 'courses'),
    tx('t2', '2025-07-12', 50, 'courses'),
    tx('t3', '2025-08-12', 90, 'courses'),
    tx('t4', '2025-07-20', 60, 'loisirs'),
    tx('t5', '2025-09-02', 300, 'courses'),
    tx('t6', '2025-10-02', 999, 'courses'),
  ];

  it('divise par tous les mois terminés, mois en cours et prévisions exclus', () => {
    const { categories, months, average } = categoryAverages(build(base), 'expense', '2025-09-10');
    expect(months.map((m) => m.key)).toEqual(['2025-06', '2025-07', '2025-08']);
    // (100 + 50 + 90) / 3 mois, même si la catégorie est absente d'aucun mois ici.
    expect(categories[0]).toMatchObject({ id: 'courses', total: 240, average: 80, count: 3, months: 3 });
    // 60 € une seule fois, mais la moyenne porte bien sur les 3 mois.
    expect(categories[1]).toMatchObject({ id: 'loisirs', total: 60, average: 20, count: 1, months: 1 });
    expect(average).toBe(100);
  });

  it('ne retient que les derniers mois demandés', () => {
    const { months, categories } = categoryAverages(build(base), 'expense', '2025-09-10', 2);
    expect(months.map((m) => m.key)).toEqual(['2025-07', '2025-08']);
    expect(categories[0]).toMatchObject({ id: 'courses', total: 140, average: 70 });
  });

  it('compte les échéances automatiques déjà passées', () => {
    const salary: Recurring = {
      id: 'r1',
      accountId: 'a1',
      type: 'income',
      amount: 1800,
      label: 'Salaire',
      category: 'salaire',
      day: 5,
      startMonth: '2025-06',
      endMonth: null,
      skipped: ['2025-07'],
    };
    const { categories, average } = categoryAverages(build(base, [salary]), 'income', '2025-09-10');
    // Juin et août versés, juillet ignoré : 3600 € sur 3 mois.
    expect(categories[0]).toMatchObject({ id: 'salaire', total: 3600, average: 1200, count: 2, months: 2 });
    expect(average).toBe(1200);
  });

  it('ne renvoie aucun mois quand le premier n’est pas terminé', () => {
    const months = buildTimeline({
      accounts: [{ ...account, startDate: '2025-09-01' }],
      transactions: [tx('t1', '2025-09-02', 40, 'courses')],
      recurrings: [],
      accountIds: ['a1'],
      today: '2025-09-10',
      futureMonths: 1,
    }).months;
    const stats = categoryAverages(months, 'expense', '2025-09-10');
    expect(stats.months).toHaveLength(0);
    expect(stats.categories).toHaveLength(0);
    expect(stats.average).toBe(0);
  });
});

describe('prévision des mois à venir', () => {
  const account: Account = { id: 'a1', name: 'Courant', color: 'violet', initialBalance: 1000, startDate: '2025-06-01' };
  const tx = (id: string, date: string, amount: number): Transaction => ({
    id,
    accountId: 'a1',
    type: 'expense',
    amount,
    date,
    label: 'Courses',
    category: 'courses',
  });
  // Juin, juillet et août terminés à 100 € de dépenses : le niveau habituel est de 100 € par mois.
  const history = [tx('t1', '2025-06-12', 100), tx('t2', '2025-07-12', 100), tx('t3', '2025-08-12', 100)];
  const build = (transactions: Transaction[], recurrings: Recurring[] = []) =>
    buildTimeline({ accounts: [account], transactions, recurrings, accountIds: ['a1'], today: '2025-09-10', futureMonths: 1 });

  it('complète les jours à venir jusqu’au niveau habituel', () => {
    const { months, forecast } = build([...history, tx('t4', '2025-09-02', 30)]);
    expect(forecast).toBe(true);
    const [juin, , , septembre, octobre] = months;
    // Mois terminé : rien n'est ajouté.
    expect(juin.estExpense).toBe(juin.expense);
    expect(juin.days.every((d) => d.estBalance === d.balance)).toBe(true);
    // Septembre : 30 € déjà dépensés, 70 € répartis sur les 20 jours restants.
    expect(septembre.days.filter((d) => d.future)).toHaveLength(20);
    expect(septembre.estExpense).toBeCloseTo(100, 1);
    expect(septembre.days[1].estBalance).toBe(septembre.days[1].balance);
    expect(septembre.estClosing).toBeCloseTo(septembre.closingBalance - 70, 1);
    // Octobre : tout est estimé, et le décalage de septembre se reporte sur son solde de départ.
    // La part quotidienne est arrondie au centime : le total du mois tombe à quelques centimes près.
    expect(octobre.estExpense).toBeCloseTo(100, 0);
    expect(octobre.estOpening).toBeCloseTo(octobre.openingBalance - 70, 1);
    expect(octobre.estClosing).toBeCloseTo(octobre.closingBalance - 170, 0);
  });

  it('n’ajoute rien à un mois déjà au-dessus de son niveau habituel', () => {
    const { months } = build([...history, tx('t4', '2025-09-02', 500)]);
    const septembre = months[3];
    expect(septembre.estExpense).toBe(septembre.expense);
    expect(septembre.estClosing).toBe(septembre.closingBalance);
  });

  it('compte les opérations automatiques déjà programmées avant d’estimer', () => {
    const rent: Recurring = {
      id: 'r1',
      accountId: 'a1',
      type: 'expense',
      amount: 80,
      label: 'Loyer',
      category: 'loyer',
      day: 3,
      startMonth: '2025-10',
      endMonth: null,
      skipped: [],
    };
    const octobre = build(history, [rent]).months[4];
    // 80 € de loyer déjà prévus : il ne reste que 20 € à estimer pour atteindre 100 €.
    expect(octobre.expense).toBe(80);
    expect(octobre.estExpense).toBeCloseTo(100, 0);
  });

  it('ne prévoit rien tant qu’aucun mois n’est terminé', () => {
    const { months, forecast } = buildTimeline({
      accounts: [{ ...account, startDate: '2025-09-01' }],
      transactions: [tx('t1', '2025-09-02', 40)],
      recurrings: [],
      accountIds: ['a1'],
      today: '2025-09-10',
      futureMonths: 1,
    });
    expect(forecast).toBe(false);
    expect(months.every((m) => m.days.every((d) => d.estBalance === d.balance))).toBe(true);
  });
});

describe('opérations exceptionnelles', () => {
  const account: Account = { id: 'a1', name: 'Courant', color: 'violet', initialBalance: 1000, startDate: '2025-06-01' };
  const tx = (
    id: string,
    date: string,
    amount: number,
    type: Transaction['type'],
    category: string,
    exceptional = false,
  ): Transaction => ({ id, accountId: 'a1', type, amount, date, label: category, category, exceptional });

  // Juin à août terminés, septembre en cours (today = 2025-09-10).
  const build = (transactions: Transaction[]) =>
    buildTimeline({ accounts: [account], transactions, recurrings: [], accountIds: ['a1'], today: '2025-09-10', futureMonths: 1 });

  it('reste dans le solde mais sort des totaux ordinaires', () => {
    const { months, balanceToday } = build([
      tx('t1', '2025-09-02', 1000, 'income', 'salaire'),
      tx('t2', '2025-09-03', 200, 'income', 'autre', true),
      tx('t3', '2025-09-04', 50, 'expense', 'cadeaux', true),
      tx('t4', '2025-09-05', 300, 'expense', 'courses'),
    ]);
    const septembre = months[3];
    // Totaux bruts et solde : tout est compté, l'argent est bien là.
    expect(septembre.income).toBe(1200);
    expect(septembre.expense).toBe(350);
    expect(balanceToday).toBe(1000 + 1200 - 350);
    // Part exceptionnelle isolée, et totaux « ordinaires » qui servent aux indicateurs.
    expect(septembre.oneOffIncome).toBe(200);
    expect(septembre.oneOffExpense).toBe(50);
    expect(ordinaryIncome(septembre)).toBe(1000);
    expect(ordinaryExpense(septembre)).toBe(300);
  });

  it('n’entre pas dans les moyennes par mois', () => {
    const months = build([
      tx('t1', '2025-06-12', 60, 'expense', 'courses'),
      tx('t2', '2025-07-12', 60, 'expense', 'courses'),
      tx('t3', '2025-08-12', 60, 'expense', 'courses'),
      tx('t4', '2025-07-20', 900, 'expense', 'courses', true),
    ]).months;
    const { categories, average } = categoryAverages(months, 'expense', '2025-09-10');
    expect(categories).toHaveLength(1);
    expect(categories[0]).toMatchObject({ id: 'courses', total: 180, average: 60, count: 3, months: 3 });
    expect(average).toBe(60);
  });

  it('ne gonfle pas la prévision des mois suivants', () => {
    const history = [
      tx('t1', '2025-06-05', 1000, 'income', 'salaire'),
      tx('t2', '2025-07-05', 1000, 'income', 'salaire'),
      tx('t3', '2025-08-05', 1000, 'income', 'salaire'),
    ];
    const sansCadeau = build(history).months[4];
    // Un cadeau de 5 000 € en juillet ne doit pas tripler le niveau habituel de revenus.
    const avecCadeau = build([...history, tx('t4', '2025-07-20', 5000, 'income', 'autre', true)]).months[4];
    expect(avecCadeau.estIncome).toBeCloseTo(sansCadeau.estIncome, 2);
    expect(avecCadeau.estIncome).toBeCloseTo(1000, 0);
  });

  it('ne remplit pas le niveau habituel du mois en cours', () => {
    const history = [
      tx('t1', '2025-06-05', 1000, 'income', 'salaire'),
      tx('t2', '2025-07-05', 1000, 'income', 'salaire'),
      tx('t3', '2025-08-05', 1000, 'income', 'salaire'),
    ];
    // Septembre : aucun salaire encore, mais un virement exceptionnel de 2 000 €.
    const { months } = build([...history, tx('t4', '2025-09-02', 2000, 'income', 'autre', true)]);
    const septembre = months[3];
    expect(septembre.income).toBe(2000);
    // Le cadeau ne tient pas lieu de salaire : les 1 000 € habituels restent attendus.
    expect(septembre.estIncome - septembre.income).toBeCloseTo(1000, 0);
  });
});

describe('groupes d’opérations', () => {
  const account: Account = { id: 'a1', name: 'Courant', color: 'violet', initialBalance: 0, startDate: '2025-06-01' };
  const tx = (id: string, date: string, type: Transaction['type'], amount: number, category: string, groupId?: string): Transaction =>
    ({ id, accountId: 'a1', type, amount, date, label: category, category, ...(groupId ? { groupId } : {}) });

  // Un repas de 96 € avancé pour la tablée, remboursé 2 × 32 € deux jours plus tard.
  const repas = [
    tx('t1', '2025-06-14', 'expense', 96, 'restaurant', 'g1'),
    tx('t2', '2025-06-16', 'income', 32, 'remboursement', 'g1'),
    tx('t3', '2025-06-16', 'income', 32, 'remboursement', 'g1'),
  ];
  const groupe = (extra: Partial<TxGroup> = {}): TxGroup => ({ id: 'g1', label: 'Resto', leadId: 't1', ...extra });

  const build = (transactions: Transaction[], groups: TxGroup[], accountIds = ['a1']) =>
    buildTimeline({ accounts: [account], transactions, recurrings: [], groups, accountIds, today: '2025-09-10', futureMonths: 1 });

  it('laisse le solde intact et ne retient que le net', () => {
    const { months } = build(repas, [groupe()]);
    const juin = months[0];
    // Les trois mouvements ont bien eu lieu.
    expect(juin.income).toBe(64);
    expect(juin.expense).toBe(96);
    expect(juin.closingBalance).toBe(-32);
    // Les indicateurs ne retiennent que 32 € de dépense.
    expect(ordinaryExpense(juin)).toBe(32);
    expect(ordinaryIncome(juin)).toBe(0);
  });

  it('porte le net sur la catégorie de l’opération principale', () => {
    const months = build(repas, [groupe()]).months;
    const depenses = categoryAverages(months, 'expense', '2025-09-10');
    expect(depenses.categories).toEqual([
      expect.objectContaining({ id: 'restaurant', total: 32, count: 1, months: 1 }),
    ]);
    // Les remboursements ne gonflent plus la catégorie « remboursement ».
    expect(categoryAverages(months, 'income', '2025-09-10').categories).toEqual([]);
  });

  it('accepte un montant retenu choisi à la main', () => {
    const juin = build(repas, [groupe({ amount: 50, type: 'expense' })]).months[0];
    expect(ordinaryExpense(juin)).toBe(50);
    expect(juin.closingBalance).toBe(-32);
  });

  it('bascule en revenu quand le remboursement dépasse la dépense', () => {
    const trop = [repas[0], tx('t2', '2025-06-16', 'income', 120, 'remboursement', 'g1')];
    const juin = build(trop, [groupe()]).months[0];
    expect(ordinaryIncome(juin)).toBe(24);
    expect(ordinaryExpense(juin)).toBe(0);
    // Le revenu est rangé dans la catégorie de l'opération principale.
    const revenus = categoryAverages(build(trop, [groupe()]).months, 'income', '2025-09-10');
    expect(revenus.categories[0]).toMatchObject({ id: 'restaurant', total: 24 });
  });

  it('ne change rien quand un seul membre est visible', () => {
    // Le remboursement est arrivé sur un autre compte, non affiché ici.
    const juin = build([repas[0]], [groupe()]).months[0];
    expect(ordinaryExpense(juin)).toBe(96);
  });

  it('groupNet additionne les dépenses et retranche les revenus', () => {
    expect(groupNet([{ type: 'expense', amount: 96 }, { type: 'income', amount: 64 }])).toEqual({ amount: 32, type: 'expense' });
    expect(groupNet([{ type: 'expense', amount: 96 }, { type: 'income', amount: 120 }])).toEqual({ amount: 24, type: 'income' });
    expect(groupNet([{ type: 'expense', amount: 10 }, { type: 'income', amount: 10 }])).toEqual({ amount: 0, type: 'expense' });
  });
});
