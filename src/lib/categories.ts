import type { CustomCategory, TxType } from './types';

export interface Category {
  id: string;
  label: string;
  icon: string;
}

// Les identifiants sont enregistrés dans les données : ne jamais les renommer.
// Un même id peut exister dans les deux listes (ex. « loyer » payé ou perçu).
export const EXPENSE_CATEGORIES: Category[] = [
  { id: 'courses', label: 'Courses', icon: '🛒' },
  { id: 'restaurant', label: 'Restaurant', icon: '🍽️' },
  { id: 'loyer', label: 'Loyer', icon: '🔑' },
  { id: 'logement', label: 'Logement', icon: '🏠' },
  { id: 'transport', label: 'Transport', icon: '🚗' },
  { id: 'carburant', label: 'Carburant', icon: '⛽' },
  { id: 'abonnements', label: 'Abonnements', icon: '📱' },
  { id: 'loisirs', label: 'Loisirs', icon: '🎬' },
  { id: 'shopping', label: 'Shopping', icon: '🛍️' },
  { id: 'sante', label: 'Santé', icon: '💊' },
  { id: 'beaute', label: 'Coiffeur & beauté', icon: '💇' },
  { id: 'voyage', label: 'Voyage', icon: '✈️' },
  { id: 'epargne', label: 'Épargne', icon: '🐷' },
  { id: 'virement', label: 'Virement', icon: '💶' },
  { id: 'autre', label: 'Autre', icon: '✨' },
];

export const INCOME_CATEGORIES: Category[] = [
  { id: 'salaire', label: 'Salaire', icon: '💼' },
  { id: 'prime', label: 'Prime', icon: '🏆' },
  { id: 'loyer', label: 'Loyer', icon: '🔑' },
  { id: 'sante', label: 'Santé', icon: '💊' },
  { id: 'remboursement', label: 'Remboursement', icon: '↩️' },
  { id: 'cadeau', label: 'Cadeau', icon: '🎁' },
  { id: 'interets', label: 'Intérêts', icon: '📈' },
  { id: 'vente', label: 'Vente', icon: '🏷️' },
  { id: 'virement', label: 'Virement', icon: '💶' },
  { id: 'autre', label: 'Autre', icon: '✨' },
];

/**
 * Catégories créées par l'utilisateur. L'application les dépose ici à chaque rendu, avant celui de
 * ses enfants : tout l'arbre lit donc la même liste sans avoir à la faire descendre partout.
 * Le cache garde une liste stable par type tant que rien ne change (dépendances de useMemo).
 */
let custom: CustomCategory[] = [];
const cache = new Map<TxType, Category[]>();

export function setCustomCategories(list: CustomCategory[]) {
  if (list === custom) return;
  custom = list;
  cache.clear();
}

export function categoriesFor(type: TxType): Category[] {
  const cached = cache.get(type);
  if (cached) return cached;
  const base = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const mine = custom.filter((c) => c.type === type);
  // « Autre » reste la dernière : c'est elle qui sert de repli quand une catégorie a disparu.
  const list = mine.length ? [...base.slice(0, -1), ...mine, base[base.length - 1]] : base;
  cache.set(type, list);
  return list;
}

export function categoryOf(type: TxType, id: string): Category {
  const list = categoriesFor(type);
  return list.find((c) => c.id === id) ?? list[list.length - 1];
}

/** Couleurs de compte, dans l'ordre du sélecteur. Les dégradés sont dans styles.css (.acct--<id>). */
export const ACCOUNT_COLORS = [
  { id: 'violet', label: 'Violet' },
  { id: 'indigo', label: 'Indigo' },
  { id: 'ocean', label: 'Océan' },
  { id: 'sky', label: 'Ciel' },
  { id: 'teal', label: 'Lagon' },
  { id: 'emerald', label: 'Émeraude' },
  { id: 'forest', label: 'Forêt' },
  { id: 'lime', label: 'Citron vert' },
  { id: 'gold', label: 'Or' },
  { id: 'orange', label: 'Orange' },
  { id: 'sunset', label: 'Coucher de soleil' },
  { id: 'coral', label: 'Corail' },
  { id: 'crimson', label: 'Rouge' },
  { id: 'rose', label: 'Rose' },
  { id: 'fuchsia', label: 'Fuchsia' },
  { id: 'aurora', label: 'Aurore' },
  { id: 'slate', label: 'Ardoise' },
  { id: 'graphite', label: 'Graphite' },
] as const;
