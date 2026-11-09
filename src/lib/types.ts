export type TxType = 'income' | 'expense';

export interface Account {
  id: string;
  name: string;
  color: string;
  /** Solde avant la première opération. */
  initialBalance: number;
  /** Date d'ouverture (YYYY-MM-DD) : le graphique démarre ce mois-là. */
  startDate: string;
  /** Numéros de compte bancaire déjà importés dans ce compte (relevés CSV). */
  bankRefs?: string[];
  /** Compte mis de côté : gardé avec toutes ses opérations, mais sorti des écrans courants. */
  archived?: boolean;
}

/** Catégorie créée par l'utilisateur, en plus de celles fournies avec l'application. */
export interface CustomCategory {
  id: string;
  label: string;
  icon: string;
  type: TxType;
}

export interface Transaction {
  id: string;
  accountId: string;
  type: TxType;
  /** Toujours positif, le sens est donné par `type`. */
  amount: number;
  date: string;
  label: string;
  category: string;
  /** Empreinte de la ligne du relevé bancaire importé : empêche de l'importer deux fois. */
  importKey?: string;
  /** Groupe auquel l'opération appartient (voir TxGroup), s'il y en a un. */
  groupId?: string;
  /**
   * Opération exceptionnelle (cadeau reçu, remboursement, achat unique…) : elle compte dans le
   * solde, comme n'importe quelle autre, mais sort du bilan du mois, du taux d'épargne, des
   * moyennes par mois et de la prévision. Rien n'est supprimé : le drapeau se retire.
   */
  exceptional?: boolean;
}

/** Opération mensuelle automatique (salaire, loyer…). */
export interface Recurring {
  id: string;
  accountId: string;
  type: TxType;
  amount: number;
  label: string;
  category: string;
  /** Jour du mois souhaité (1-31). */
  day: number;
  /** Premier mois concerné (YYYY-MM). */
  startMonth: string;
  /** Dernier mois concerné (YYYY-MM), ou null si sans fin. */
  endMonth: string | null;
  /** Mois ignorés (YYYY-MM). */
  skipped: string[];
}

/** Opération réelle ou occurrence générée d'une opération automatique. */
export interface Entry extends Transaction {
  recurringId?: string;
  monthKey?: string;
  /**
   * Montant retenu par les indicateurs (catégories, bilans, moyennes, prévision), calculé par
   * buildTimeline. Il vaut `amount`, sauf dans un groupe : 0 pour une opération secondaire, le
   * montant du groupe pour son opération principale. Le solde, lui, compte toujours `amount`.
   */
  budget: number;
  /** Sens du montant retenu : un groupe remboursé au-delà de la dépense devient un revenu. */
  budgetType: TxType;
}

export type ThemeMode = 'dark' | 'light';

/**
 * Découpage des « mois » : calendaire (du 1er au dernier jour), à partir d'un jour fixe,
 * ou à partir du jour d'une opération automatique (ex. le salaire). Hors calendaire,
 * le début suit le décalage des week-ends des opérations automatiques.
 */
export type PeriodSetting =
  | { kind: 'calendar' }
  | { kind: 'day'; day: number }
  | { kind: 'rule'; recurringId: string };

/**
 * Groupe d'opérations liées : une dépense et son remboursement, un achat et son retour…
 * Les opérations gardent leur montant réel dans le solde, mais les indicateurs (catégories,
 * bilans, moyennes, prévision) ne retiennent que le montant du groupe, porté par son opération
 * principale. Les autres membres sont « secondaires » : ils n'y comptent pour rien.
 */
export interface TxGroup {
  id: string;
  label: string;
  /** Opération principale : c'est sa catégorie qui reçoit le montant retenu. */
  leadId: string;
  /** Montant retenu, toujours positif. Par défaut, le net du groupe (voir groupNet). */
  amount?: number;
  /** Sens du montant retenu. Par défaut, celui du net. */
  type?: TxType;
}

export interface AppState {
  version: 1;
  accounts: Account[];
  transactions: Transaction[];
  recurrings: Recurring[];
  theme: ThemeMode;
  period: PeriodSetting;
  /** Compte affiché à l'ouverture de l'app (null = le premier du bandeau). */
  primaryId: string | null;
  /** Catégories créées par l'utilisateur. */
  categories: CustomCategory[];
  /** Groupes d'opérations liées. */
  groups: TxGroup[];
}
