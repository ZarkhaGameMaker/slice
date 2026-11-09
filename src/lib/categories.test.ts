import { afterEach, describe, expect, it } from 'vitest';
import { categoriesFor, categoryOf, setCustomCategories } from './categories';
import { demoState, emptyState, reducer, sanitizeState } from './store';
import type { CustomCategory, Transaction, TxGroup } from './types';

const essence: CustomCategory = { id: 'c:1', label: 'Péages', icon: '🛣️', type: 'expense' };
const prime: CustomCategory = { id: 'c:2', label: 'Pourboires', icon: '🤝', type: 'income' };

afterEach(() => setCustomCategories([]));

describe('catégories personnalisées', () => {
  it('s’ajoutent à leur type, juste avant « Autre »', () => {
    setCustomCategories([essence, prime]);
    const depenses = categoriesFor('expense');
    const revenus = categoriesFor('income');
    expect(depenses.map((c) => c.id)).toContain('c:1');
    expect(depenses.map((c) => c.id)).not.toContain('c:2');
    // « Autre » reste la dernière : c'est le repli d'une catégorie inconnue.
    expect(depenses[depenses.length - 1].id).toBe('autre');
    expect(revenus[revenus.length - 1].id).toBe('autre');
    expect(categoryOf('expense', 'c:1').label).toBe('Péages');
    expect(categoryOf('income', 'c:2').icon).toBe('🤝');
  });

  it('retombent sur « Autre » quand la catégorie n’existe plus', () => {
    setCustomCategories([]);
    expect(categoryOf('expense', 'c:1').id).toBe('autre');
  });

  it('redonnent la même liste tant que rien ne change (mémorisation)', () => {
    setCustomCategories([essence]);
    expect(categoriesFor('expense')).toBe(categoriesFor('expense'));
    setCustomCategories([essence, prime]);
    expect(categoriesFor('expense').map((c) => c.id)).toContain('c:1');
  });
});

describe('réducteur : catégories et comptes de côté', () => {
  const tx = (id: string, category: string): Transaction => ({
    id,
    accountId: 'a1',
    type: 'expense',
    amount: 10,
    date: '2026-01-05',
    label: 'Test',
    category,
  });
  const base = {
    ...emptyState(),
    accounts: [{ id: 'a1', name: 'Courant', color: 'violet', initialBalance: 0, startDate: '2026-01-01' }],
    transactions: [tx('t1', 'c:1'), tx('t2', 'courses')],
    categories: [essence],
    primaryId: 'a1',
  };

  it('supprimer une catégorie bascule ses opérations dans « Autre »', () => {
    const next = reducer(base, { type: 'category/delete', id: 'c:1' });
    expect(next.categories).toHaveLength(0);
    expect(next.transactions.map((t) => t.category)).toEqual(['autre', 'courses']);
  });

  it('mettre un compte de côté garde ses opérations et le retire des comptes principaux', () => {
    const next = reducer(base, { type: 'account/archive', id: 'a1', archived: true });
    expect(next.accounts[0].archived).toBe(true);
    expect(next.transactions).toHaveLength(2);
    expect(next.primaryId).toBeNull();
    const back = reducer(next, { type: 'account/archive', id: 'a1', archived: false });
    expect(back.accounts[0].archived).toBeUndefined();
  });
});

describe('entretien des groupes', () => {
  const tx = (id: string, type: Transaction['type'], amount: number): Transaction => ({
    id, accountId: 'a1', type, amount, date: '2025-06-14', label: id, category: 'restaurant', groupId: 'g1',
  });
  const group: TxGroup = { id: 'g1', label: 'Resto', leadId: 't1' };
  const base = { ...emptyState(), transactions: [tx('t1', 'expense', 96), tx('t2', 'income', 64)], groups: [group] };

  it('dissout le groupe quand il ne reste qu’une opération', () => {
    const next = reducer(base, { type: 'tx/delete', id: 't2' });
    expect(next.groups).toEqual([]);
    expect(next.transactions[0].groupId).toBeUndefined();
  });

  it('reprend une opération principale quand celle-ci disparaît', () => {
    const trois = { ...base, transactions: [...base.transactions, tx('t3', 'income', 10)] };
    const next = reducer(trois, { type: 'tx/delete', id: 't1' });
    expect(next.groups).toHaveLength(1);
    expect(next.groups[0].leadId).toBe('t2');
  });

  it('remplace la composition du groupe à l’enregistrement', () => {
    const trois = { ...base, transactions: [...base.transactions, { ...tx('t3', 'income', 10), groupId: undefined }] };
    const next = reducer(trois, { type: 'group/save', group, members: ['t1', 't3'] });
    expect(next.transactions.map((t) => t.groupId)).toEqual(['g1', undefined, 'g1']);
  });

  it('dissout le groupe sans toucher aux opérations', () => {
    const next = reducer(base, { type: 'group/delete', id: 'g1' });
    expect(next.groups).toEqual([]);
    expect(next.transactions).toHaveLength(2);
    expect(next.transactions.every((t) => t.groupId === undefined)).toBe(true);
  });
});

describe('démo', () => {
  it('fournit un groupe cohérent, qui survit au nettoyage', () => {
    const demo = demoState('dark');
    expect(demo.groups).toHaveLength(1);
    const g = demo.groups[0];
    expect(demo.transactions.some((t) => t.id === g.leadId)).toBe(true);
    expect(demo.transactions.filter((t) => t.groupId === g.id)).toHaveLength(3);
    // Aller-retour par le fichier de comptes : le groupe doit passer intact.
    expect(sanitizeState(JSON.parse(JSON.stringify(demo)))?.groups).toEqual(demo.groups);
  });
});
