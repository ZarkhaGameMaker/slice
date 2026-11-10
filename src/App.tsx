import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { AccountCarousel, type CarouselItem } from './components/AccountCarousel';
import { AccountOrderForm } from './components/AccountOrder';
import { CategoryAverages } from './components/CategoryAverages';
import { CategoryManager } from './components/CategoryForm';
import { CategoryTreemap, type CategorySelection } from './components/CategoryTreemap';
import { FileChip } from './components/FileChip';
import { AccountForm, OccurrenceSheet, PeriodForm, RecurringForm, TransactionForm } from './components/Forms';
import { ImportDialog, type ImportResult } from './components/ImportDialog';
import {
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  CloseIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  Logo,
  MinusIcon,
  MoonIcon,
  MoreIcon,
  PlusIcon,
  ReorderIcon,
  RepeatIcon,
  SaveIcon,
  SparkIcon,
  SunIcon,
  TagIcon,
  TrashIcon,
  UploadIcon,
} from './components/Icons';
import { ConfirmDialog } from './components/Modal';
import { MonthRail } from './components/MonthRail';
import { MonthStrip } from './components/MonthStrip';
import { RecurringList } from './components/RecurringList';
import { Stats } from './components/Stats';
import { Toast, type ToastData } from './components/Toast';
import { GroupForm } from './components/GroupForm';
import { TransactionList } from './components/TransactionList';
import { setCustomCategories } from './lib/categories';
import { todayISO } from './lib/dates';
import { decodeText, readBankCsv, type CsvTable } from './lib/csv';
import { parseStateText, serializeState, useDataFile } from './lib/dataFile';
import { buildTimeline, monthIndexOf, periodDay, periodKeyOf, type Timeline } from './lib/finance';
import { dayFullLabel, money, monthLabel, periodRange, plural } from './lib/format';
import { usePresence, useViewport } from './lib/motion';
import { demoState, emptyState, useAppStore } from './lib/store';
import type { Account, AppState, CustomCategory, Entry, PeriodSetting, Recurring, Transaction, TxGroup, TxType } from './lib/types';

type ModalState =
  | { kind: 'tx'; tx?: Transaction; type: TxType }
  | { kind: 'rec'; rec?: Recurring; type: TxType }
  | { kind: 'account'; account?: Account }
  | { kind: 'occurrence'; entry: Entry }
  | { kind: 'group'; tx: Transaction; group?: TxGroup }
  | { kind: 'period' }
  | { kind: 'categories' }
  | { kind: 'order' }
  | { kind: 'import'; fileName: string; table: CsvTable }
  | {
      kind: 'confirm';
      title: string;
      message: string;
      confirmLabel: string;
      onConfirm: () => void;
      altLabel?: string;
      onAlt?: () => void;
      tone?: 'danger' | 'primary';
    }
  | null;

const ALL = 'all';

/** Date du jour, rafraîchie si l'app reste ouverte après minuit. */
function useToday() {
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const t = window.setInterval(() => setToday(todayISO()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return today;
}

/** Revenus et dépenses déjà passés de la période en cours. */
function realizedThisMonth(t: Timeline, today: string) {
  const m = t.months[monthIndexOf(t.months, today)];
  let income = 0;
  let expense = 0;
  for (const d of m?.days ?? []) {
    if (d.future) break;
    income += d.income;
    expense += d.expense;
  }
  return { income, expense };
}

export default function App() {
  const [state, dispatch, saved] = useAppStore();
  const today = useToday();
  // À l'ouverture : le compte principal s'il y en a un, sinon le premier du bandeau.
  const [selectedId, setSelectedId] = useState<string>(() => state.primaryId ?? state.accounts[0]?.id ?? ALL);
  const [focusedKey, setFocusedKey] = useState(() => periodKeyOf(todayISO(), periodDay(state.period, state.recurrings)));
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [category, setCategory] = useState<CategorySelection | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const viewport = useViewport();
  const menu = usePresence(menuOpen || null);
  const fileRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { accounts, transactions, recurrings, groups } = state;
  // Jour de début des « mois » (null = du 1er au dernier jour).
  const startDay = periodDay(state.period, recurrings);
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  // Les catégories de l'utilisateur sont déposées avant le rendu des enfants, qui les lisent
  // tous (voir lib/categories.ts) : un useEffect arriverait trop tard. L'appel se garde lui-même.
  setCustomCategories(state.categories);

  // Comptes en service, et comptes réellement affichés (ceux mis de côté restent dans les données).
  const live = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);
  const archivedCount = accounts.length - live.length;
  // Si tout est de côté, on les affiche quand même : l'écran ne doit pas rester vide.
  const shown = useMemo(() => (showArchived || !live.length ? accounts : live), [accounts, live, showArchived]);
  /** Comptes proposés dans un formulaire : ceux en service, plus celui de l'opération modifiée. */
  const pickable = (id?: string) => {
    const extra = id && !live.some((a) => a.id === id) ? accountMap.get(id) : undefined;
    return extra ? [...live, extra] : live;
  };
  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of transactions) map.set(t.category, (map.get(t.category) ?? 0) + 1);
    for (const r of recurrings) map.set(r.category, (map.get(r.category) ?? 0) + 1);
    return map;
  }, [transactions, recurrings]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', state.theme === 'dark' ? '#0b0d12' : '#f3f4f8');
  }, [state.theme]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  /* ---------- Calculs ---------- */

  const timelines = useMemo(() => {
    const map = new Map<string, Timeline>();
    for (const a of shown) {
      map.set(a.id, buildTimeline({ accounts, transactions, recurrings, groups, accountIds: [a.id], today, startDay }));
    }
    if (live.length > 1) {
      const accountIds = live.map((a) => a.id);
      map.set(ALL, buildTimeline({ accounts, transactions, recurrings, groups, accountIds, today, startDay }));
    }
    return map;
  }, [accounts, live, shown, transactions, recurrings, groups, today, startDay]);

  const items: CarouselItem[] = useMemo(() => {
    const list: CarouselItem[] = shown.map((a) => {
      const t = timelines.get(a.id)!;
      const month = realizedThisMonth(t, today);
      const count = transactions.filter((x) => x.accountId === a.id).length;
      const autos = recurrings.filter((r) => r.accountId === a.id).length;
      return {
        id: a.id,
        kind: 'account',
        name: a.name,
        color: a.color,
        balance: t.balanceToday,
        monthIncome: month.income,
        monthExpense: month.expense,
        subtitle: `${count} opération${plural(count)}${autos ? ` · ${autos} auto` : ''}`,
        primary: state.primaryId === a.id,
        archived: !!a.archived,
      };
    });
    if (live.length > 1) {
      const t = timelines.get(ALL)!;
      const month = realizedThisMonth(t, today);
      list.unshift({
        id: ALL,
        kind: 'all',
        name: 'Tous les comptes',
        color: 'total',
        balance: t.balanceToday,
        monthIncome: month.income,
        monthExpense: month.expense,
        subtitle: `${live.length} comptes réunis`,
        primary: false,
        archived: false,
      });
    }
    return list;
  }, [shown, live, transactions, recurrings, timelines, today, state.primaryId]);

  const selectedIndex = Math.max(0, items.findIndex((i) => i.id === selectedId));
  const selected = items[selectedIndex];
  const isAll = selected?.kind === 'all';
  const timeline = selected ? timelines.get(selected.id) : undefined;
  const months = timeline?.months ?? [];

  let monthIndex = months.findIndex((m) => m.key === focusedKey);
  if (monthIndex < 0 && months.length) monthIndex = focusedKey < months[0].key ? 0 : months.length - 1;
  const month = months[monthIndex];
  const todayIndex = monthIndexOf(months, today);
  const todayKey = months[todayIndex]?.key ?? periodKeyOf(today, startDay);

  // L'accent de toute la page (boutons, courbe, surlignages, halo) prend la couleur du compte affiché.
  const accent = selected?.color;
  useEffect(() => {
    const root = document.documentElement;
    [...root.classList].forEach((c) => c.startsWith('acct--') && root.classList.remove(c));
    if (accent) root.classList.add(`acct--${accent}`);
  }, [accent]);

  const activeIds = useMemo(
    () => (isAll ? new Set(live.map((a) => a.id)) : new Set(selected ? [selected.id] : [])),
    [isAll, live, selected],
  );
  const activeRules = recurrings.filter((r) => activeIds.has(r.accountId));
  const defaultAccountId = isAll || !selected ? live[0]?.id ?? accounts[0]?.id ?? '' : selected.id;

  /** Date proposée pour une nouvelle opération : aujourd'hui, ou le même jour dans la période affichée. */
  const defaultDate = () => {
    if (!month || (month.start <= today && today <= month.end)) return today;
    const sameDay = month.days.find((d) => d.day === Number(today.slice(8, 10)));
    return sameDay?.date ?? month.start;
  };

  /* ---------- Actions ---------- */

  const notify = useCallback((message: string, onUndo?: () => void) => {
    setToast({ id: Date.now(), message, onUndo });
  }, []);
  const clearToast = useCallback(() => setToast(null), []);
  const closeModal = useCallback(() => setModal(null), []);

  const revealAccount = (accountId: string) => {
    if (!isAll) setSelectedId(accountId);
  };

  const saveTx = (tx: Transaction, isNew: boolean) => {
    dispatch({ type: isNew ? 'tx/add' : 'tx/update', tx });
    revealAccount(tx.accountId);
    setFocusedKey(periodKeyOf(tx.date, startDay));
    notify(isNew ? `${tx.type === 'income' ? 'Revenu' : 'Dépense'} ajouté${tx.type === 'expense' ? 'e' : ''} · ${money(tx.amount)}` : 'Opération modifiée');
  };

  const deleteTx = (tx: Transaction) => {
    dispatch({ type: 'tx/delete', id: tx.id });
    setModal(null);
    notify(`« ${tx.label} » supprimé`, () => dispatch({ type: 'tx/add', tx }));
  };

  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  const openGroup = (entry: Entry) => {
    const tx = transactions.find((t) => t.id === entry.id);
    if (tx) setModal({ kind: 'group', tx, group: tx.groupId ? groupsById.get(tx.groupId) : undefined });
  };

  const saveGroup = (group: TxGroup, members: string[]) => {
    const before = groups.find((g) => g.id === group.id);
    const beforeMembers = transactions.filter((t) => t.groupId === group.id).map((t) => t.id);
    dispatch({ type: 'group/save', group, members });
    notify(
      before ? `Groupe « ${group.label} » modifié` : `${members.length} opérations regroupées · « ${group.label} »`,
      before
        ? () => dispatch({ type: 'group/save', group: before, members: beforeMembers })
        : () => dispatch({ type: 'group/delete', id: group.id }),
    );
  };

  const dissolveGroup = (group: TxGroup) => {
    const members = transactions.filter((t) => t.groupId === group.id).map((t) => t.id);
    dispatch({ type: 'group/delete', id: group.id });
    setModal(null);
    notify(`Groupe « ${group.label} » dissous`, () => dispatch({ type: 'group/save', group, members }));
  };

  /** Marque l'opération comme exceptionnelle, ou lui rend son statut ordinaire. */
  const toggleExceptional = (entry: Entry) => {
    const tx = transactions.find((t) => t.id === entry.id);
    if (!tx) return;
    const on = !tx.exceptional;
    dispatch({ type: 'tx/update', tx: { ...tx, exceptional: on || undefined } });
    notify(
      on
        ? `« ${tx.label} » est exceptionnelle · hors bilan, moyennes et prévision`
        : `« ${tx.label} » redevient une opération ordinaire`,
      () => dispatch({ type: 'tx/update', tx }),
    );
  };

  const skipOccurrence = (entry: Entry) => {
    if (!entry.recurringId || !entry.monthKey) return;
    const { recurringId: id, monthKey: m } = entry;
    dispatch({ type: 'rec/skip', id, month: m });
    notify(`« ${entry.label} » ignoré pour ${monthLabel(m).toLowerCase()}`, () => dispatch({ type: 'rec/unskip', id, month: m }));
  };

  const saveRec = (rec: Recurring, isNew: boolean) => {
    dispatch({ type: isNew ? 'rec/add' : 'rec/update', rec });
    revealAccount(rec.accountId);
    notify(isNew ? `« ${rec.label} » programmé le ${rec.day} de chaque mois` : 'Opération automatique modifiée');
  };

  const deleteRec = (rec: Recurring) =>
    setModal({
      kind: 'confirm',
      title: 'Supprimer l’opération automatique ?',
      message: `« ${rec.label} » et toutes ses échéances (passées et à venir) disparaîtront du solde.`,
      confirmLabel: 'Supprimer',
      onConfirm: () => {
        dispatch({ type: 'rec/delete', id: rec.id });
        notify(`« ${rec.label} » supprimé`, () => dispatch({ type: 'rec/add', rec }));
      },
    });

  const saveAccount = (account: Account, isNew: boolean, primary: boolean) => {
    const before = accountMap.get(account.id);
    dispatch({ type: isNew ? 'account/add' : 'account/update', account });
    const wasPrimary = state.primaryId === account.id;
    if (primary !== wasPrimary) dispatch({ type: 'account/primary', id: primary ? account.id : null });
    if (isNew) setSelectedId(account.id);
    // Mise de côté (ou retour en service) : on le dit clairement, et on quitte le compte masqué.
    if (before && !!before.archived !== !!account.archived) {
      if (account.archived) {
        if (selectedId === account.id) setSelectedId(ALL);
        return notify(`« ${account.name} » mis de côté · ses opérations sont conservées`, () => {
          dispatch({ type: 'account/update', account: before });
          if (wasPrimary) dispatch({ type: 'account/primary', id: account.id });
        });
      }
      return notify(`« ${account.name} » remis en service`);
    }
    notify(isNew ? `Compte « ${account.name} » créé` : 'Compte modifié');
  };

  const addCategory = (category: CustomCategory) => {
    dispatch({ type: 'category/add', category });
    notify(`Catégorie « ${category.icon} ${category.label} » créée`);
  };

  const updateCategory = (category: CustomCategory) => {
    dispatch({ type: 'category/update', category });
    notify('Catégorie modifiée');
  };

  const deleteCategory = (category: CustomCategory) => {
    const txs = transactions.filter((t) => t.category === category.id);
    const recs = recurrings.filter((r) => r.category === category.id);
    const moved = txs.length + recs.length;
    dispatch({ type: 'category/delete', id: category.id });
    notify(
      `« ${category.label} » supprimée${moved ? ` · ${moved} opération${plural(moved)} dans « Autre »` : ''}`,
      () => {
        dispatch({ type: 'category/add', category });
        for (const tx of txs) dispatch({ type: 'tx/update', tx });
        for (const rec of recs) dispatch({ type: 'rec/update', rec });
      },
    );
  };

  const togglePrimary = (id: string) => {
    const before = state.primaryId;
    const next = before === id ? null : id;
    const name = accountMap.get(id)?.name ?? '';
    dispatch({ type: 'account/primary', id: next });
    notify(
      next ? `« ${name} » s’affichera à l’ouverture` : `« ${name} » n’est plus le compte principal`,
      () => dispatch({ type: 'account/primary', id: before }),
    );
  };

  const deleteAccount = (account: Account) =>
    setModal({
      kind: 'confirm',
      title: `Supprimer « ${account.name} » ?`,
      message: 'Le compte, ses opérations et ses opérations automatiques seront supprimés.',
      confirmLabel: 'Supprimer le compte',
      onConfirm: () => {
        const txs = transactions.filter((t) => t.accountId === account.id);
        const recs = recurrings.filter((r) => r.accountId === account.id);
        const primary = state.primaryId === account.id;
        dispatch({ type: 'account/delete', id: account.id });
        setSelectedId(ALL);
        notify(`Compte « ${account.name} » supprimé`, () => {
          dispatch({ type: 'account/restore', account, transactions: txs, recurrings: recs, primary });
          setSelectedId(account.id);
        });
      },
    });

  /** `keepView` : garde le compte et le mois affichés s'ils existent encore (fichier rechargé). */
  const replaceAll = (next: AppState, message: string, keepView = false) => {
    dispatch({ type: 'replace', state: next });
    const stillThere = selectedId === ALL ? next.accounts.length > 1 : next.accounts.some((a) => a.id === selectedId);
    if (!keepView || !stillThere) {
      setSelectedId(next.primaryId ?? next.accounts[0]?.id ?? ALL);
      setFocusedKey(periodKeyOf(today, periodDay(next.period, next.recurrings)));
    }
    notify(message);
  };

  // Fichier de comptes sur le disque : Ouvrir / Enregistrer / Enregistrer sous.
  const file = useDataFile(state, {
    load: (next, message, keepView) => replaceAll({ ...next, theme: state.theme }, message, keepView),
    notify,
    ask: (question) => setModal({ kind: 'confirm', tone: 'primary', ...question }),
  });
  const canSave = accounts.length > 0 || !!file.name;

  const openFile = () => {
    setMenuOpen(false);
    if (file.supported) void file.open();
    else fileRef.current?.click();
  };
  const runSave = (how: 'save' | 'saveAs') => {
    setMenuOpen(false);
    if (!canSave) return;
    if (file.supported) void file[how]();
    else exportData();
  };
  const saveFile = () => runSave('save');
  const saveFileAs = () => runSave('saveAs');

  // Raccourcis : Ctrl+S, Ctrl+Maj+S, Ctrl+O (à la place de ceux du navigateur).
  const shortcuts = useRef({ openFile, saveFile, saveFileAs, busy: false });
  shortcuts.current = { openFile, saveFile, saveFileAs, busy: modal !== null };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const run = shortcuts.current;
      if (key === 's') {
        e.preventDefault();
        if (e.shiftKey) run.saveFileAs();
        else run.saveFile();
      } else if (key === 'o' && !e.shiftKey) {
        e.preventDefault();
        if (!run.busy) run.openFile();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const loadDemo = () => {
    setMenuOpen(false);
    const run = () => {
      file.detach();
      replaceAll(demoState(state.theme), file.name ? `Démo chargée · « ${file.name} » n’a pas été modifié` : 'Données de démonstration chargées');
    };
    if (!accounts.length) return run();
    setModal({
      kind: 'confirm',
      title: 'Charger la démo ?',
      message: file.name
        ? `Vos comptes affichés seront remplacés. Le fichier « ${file.name} » sera fermé sans être modifié.`
        : 'Vos comptes actuels seront remplacés. Pensez à les enregistrer dans un fichier avant.',
      confirmLabel: 'Remplacer',
      onConfirm: run,
    });
  };

  const resetAll = () => {
    setMenuOpen(false);
    setModal({
      kind: 'confirm',
      title: 'Tout effacer ?',
      message: file.name
        ? `Tous les comptes et opérations seront supprimés de ce navigateur. Le fichier « ${file.name} » sera fermé sans être modifié.`
        : 'Tous les comptes et opérations seront supprimés de ce navigateur.',
      confirmLabel: 'Tout effacer',
      onConfirm: () => {
        file.detach();
        replaceAll({ ...emptyState(), theme: state.theme }, 'Données effacées');
      },
    });
  };

  const exportData = () => {
    setMenuOpen(false);
    const blob = new Blob([serializeState(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slice-${today}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Sauvegarde exportée');
  };

  const importData = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    try {
      const parsed = parseStateText(await picked.text());
      if (!parsed) throw new Error('format');
      const load = () => replaceAll({ ...parsed, theme: state.theme }, `« ${picked.name} » ouvert`);
      if (!accounts.length) return load();
      setModal({
        kind: 'confirm',
        title: `Ouvrir « ${picked.name} » ?`,
        message: `${parsed.accounts.length} compte(s) et ${parsed.transactions.length} opération(s) remplaceront vos données actuelles.`,
        confirmLabel: 'Ouvrir',
        tone: 'primary',
        onConfirm: load,
      });
    } catch {
      notify(`« ${picked.name} » n’est pas un fichier Slice`);
    }
  };

  const savePeriod = (period: PeriodSetting) => {
    dispatch({ type: 'period', period });
    setFocusedKey(periodKeyOf(today, periodDay(period, recurrings)));
    notify(period.kind === 'calendar' ? 'Mois du 1er au dernier jour' : 'Découpage des mois mis à jour');
  };

  const reorderAccounts = (ids: string[]) => {
    const before = accounts.map((a) => a.id);
    if (before.join() === ids.join()) return;
    dispatch({ type: 'account/reorder', ids });
    notify('Ordre des comptes mis à jour', () => dispatch({ type: 'account/reorder', ids: before }));
  };

  const openPeriod = () => {
    setMenuOpen(false);
    setModal({ kind: 'period' });
  };

  const openCsv = () => {
    setMenuOpen(false);
    csvRef.current?.click();
  };

  const readStatement = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const table = readBankCsv(decodeText(await file.arrayBuffer()));
      if (!table.rows.length) throw new Error('vide');
      setModal({ kind: 'import', fileName: file.name, table });
    } catch {
      notify('Ce fichier ne ressemble pas à un relevé bancaire CSV.');
    }
  };

  const importOperations = ({ transactions: txs, skips, alreadyImported, links }: ImportResult) => {
    const already = alreadyImported ? ` · ${alreadyImported} déjà présente${plural(alreadyImported)}` : '';
    if (!txs.length) return notify(`Aucune nouvelle opération${already}`);
    const bankRefs = Object.fromEntries(accounts.map((a) => [a.id, a.bankRefs]));
    dispatch({ type: 'tx/import', transactions: txs, skips, links });
    // Montrer ce qui vient d'arriver : le compte concerné et la période la plus récente.
    const accountIds = [...new Set(txs.map((t) => t.accountId))];
    if (accountIds.length === 1) {
      if (!isAll) setSelectedId(accountIds[0]);
    } else if (accounts.length > 1) setSelectedId(ALL);
    const latest = txs.reduce((max, t) => (t.date > max ? t.date : max), txs[0].date);
    setFocusedKey(periodKeyOf(latest, startDay));
    notify(
      `${txs.length} opération${txs.length > 1 ? 's importées' : ' importée'}${already}`,
      () => dispatch({ type: 'tx/unimport', ids: txs.map((t) => t.id), skips, bankRefs }),
    );
  };

  const openEntry = (entry: Entry) => {
    if (entry.recurringId) setModal({ kind: 'occurrence', entry });
    else {
      const tx = transactions.find((t) => t.id === entry.id);
      if (tx) setModal({ kind: 'tx', tx, type: tx.type });
    }
  };

  // Le patrimoine ne compte que les comptes en service.
  const totalWealth = live.reduce((s, a) => s + (timelines.get(a.id)?.balanceToday ?? 0), 0);

  /* ---------- Rendu ---------- */

  const header = (
    <header className="topbar">
      <div className="topbar__inner">
        <div className="brand">
          <Logo />
          <div>
            <strong>Slice</strong>
            <span>{dayFullLabel(today)}</span>
          </div>
        </div>
        {file.supported && canSave && (
          <div className="topbar__file">
            <FileChip name={file.name} status={file.status} savedAt={file.savedAt} autoSave={file.autoSave} onClick={() => void file.resume()} />
          </div>
        )}
        {live.length > 0 && (
          <div className="topbar__wealth">
            <span>Patrimoine</span>
            <strong className={totalWealth < 0 ? 'down' : undefined}>{money(totalWealth)}</strong>
          </div>
        )}
        <div className="topbar__actions">
          <button
            className="icon-btn"
            onClick={() => dispatch({ type: 'theme', theme: state.theme === 'dark' ? 'light' : 'dark' })}
            aria-label={state.theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}
          >
            {state.theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <div className="menu" ref={menuRef}>
            <button className="icon-btn" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label="Plus d’options">
              <MoreIcon />
            </button>
            {menu.item && (
              <div className="menu__pop" role="menu" data-state={menu.state}>
                {file.supported ? (
                  <>
                    <button role="menuitem" onClick={openFile}><FolderIcon width={17} height={17} /> Ouvrir un fichier… <kbd>Ctrl+O</kbd></button>
                    <button role="menuitem" onClick={saveFile} disabled={!canSave}><SaveIcon width={17} height={17} /> Enregistrer <kbd>Ctrl+S</kbd></button>
                    <button role="menuitem" onClick={saveFileAs} disabled={!canSave}><DownloadIcon width={17} height={17} /> Enregistrer sous… <kbd>Ctrl+Maj+S</kbd></button>
                    {file.name && (
                      <>
                        <label className="menu__toggle">
                          <span>
                            Enregistrement automatique
                            <small>dans « {file.name} »</small>
                          </span>
                          <span className="switch">
                            <input type="checkbox" role="menuitemcheckbox" checked={file.autoSave} onChange={(e) => file.setAutoSave(e.target.checked)} />
                            <span />
                          </span>
                        </label>
                        <button role="menuitem" onClick={() => { setMenuOpen(false); file.close(); }}><CloseIcon width={17} height={17} /> Fermer le fichier</button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <button role="menuitem" onClick={openFile}><UploadIcon width={17} height={17} /> Ouvrir une sauvegarde…</button>
                    <button role="menuitem" onClick={exportData} disabled={!accounts.length}><DownloadIcon width={17} height={17} /> Télécharger une sauvegarde</button>
                  </>
                )}
                <hr />
                <button role="menuitem" onClick={openCsv} disabled={!accounts.length}><FileIcon width={17} height={17} /> Importer un relevé bancaire (CSV)</button>
                <button role="menuitem" onClick={() => { setMenuOpen(false); setModal({ kind: 'order' }); }} disabled={accounts.length < 2}><ReorderIcon width={17} height={17} /> Réorganiser les comptes</button>
                <button role="menuitem" onClick={openPeriod} disabled={!accounts.length}><CalendarIcon width={17} height={17} /> Début du mois…</button>
                <button role="menuitem" onClick={() => { setMenuOpen(false); setModal({ kind: 'categories' }); }}><TagIcon width={17} height={17} /> Catégories…</button>
                {archivedCount > 0 && (
                  <label className="menu__toggle">
                    <span>
                      Comptes mis de côté
                      <small>{archivedCount} compte{plural(archivedCount)} · {showArchived ? 'affiché' : 'masqué'}{plural(archivedCount)}</small>
                    </span>
                    <span className="switch">
                      <input
                        type="checkbox"
                        role="menuitemcheckbox"
                        checked={showArchived}
                        onChange={(e) => setShowArchived(e.target.checked)}
                      />
                      <span />
                    </span>
                  </label>
                )}
                <button role="menuitem" onClick={loadDemo}><SparkIcon width={17} height={17} /> Charger la démo</button>
                <hr />
                <button role="menuitem" className="danger" onClick={resetAll} disabled={!accounts.length}><TrashIcon width={17} height={17} /> Tout effacer</button>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importData} />
          <input ref={csvRef} type="file" accept=".csv,text/csv,text/plain" hidden onChange={readStatement} />
        </div>
      </div>
      {!saved && (
        <div className="storage-warning" role="alert">
          ⚠️ Ce navigateur n’enregistre pas les données : elles seront perdues à la fermeture.
          Ouvrez l’application dans Edge ou Chrome (hors navigation privée), ou enregistrez vos comptes dans un fichier avant de quitter.
        </div>
      )}
    </header>
  );

  const modals = (
    <>
      {modal?.kind === 'tx' && (
        <TransactionForm
          initial={modal.tx}
          defaults={{ type: modal.type, date: defaultDate(), accountId: defaultAccountId }}
          accounts={pickable(modal.tx?.accountId)}
          onSubmit={(tx) => saveTx(tx, !modal.tx)}
          onCreateCategory={addCategory}
          onDelete={modal.tx ? () => deleteTx(modal.tx!) : undefined}
          onClose={closeModal}
        />
      )}
      {modal?.kind === 'rec' && (
        <RecurringForm
          initial={modal.rec}
          defaults={{ type: modal.type, accountId: defaultAccountId }}
          accounts={pickable(modal.rec?.accountId)}
          today={today}
          onSubmit={(rec) => saveRec(rec, !modal.rec)}
          onCreateCategory={addCategory}
          onDelete={modal.rec ? () => deleteRec(modal.rec!) : undefined}
          onClose={closeModal}
        />
      )}
      {modal?.kind === 'account' && (
        <AccountForm
          initial={modal.account}
          today={today}
          primary={!!modal.account && state.primaryId === modal.account.id}
          onSubmit={(a, primary) => saveAccount(a, !modal.account, primary)}
          onDelete={modal.account ? () => deleteAccount(modal.account!) : undefined}
          onClose={closeModal}
        />
      )}
      {modal?.kind === 'import' && (
        <ImportDialog
          fileName={modal.fileName}
          table={modal.table}
          accounts={accounts}
          transactions={transactions}
          recurrings={recurrings}
          defaultAccountId={defaultAccountId}
          onImport={importOperations}
          onClose={closeModal}
        />
      )}
      {modal?.kind === 'group' && (
        <GroupForm
          anchor={modal.tx}
          group={modal.group}
          transactions={transactions}
          accounts={accountMap}
          showAccount={accounts.length > 1}
          onSubmit={saveGroup}
          onDissolve={modal.group ? () => dissolveGroup(modal.group!) : undefined}
          onClose={closeModal}
        />
      )}
      {modal?.kind === 'order' && (
        <AccountOrderForm accounts={shown} onSubmit={reorderAccounts} onClose={closeModal} />
      )}
      {modal?.kind === 'categories' && (
        <CategoryManager
          categories={state.categories}
          counts={categoryCounts}
          onAdd={addCategory}
          onUpdate={updateCategory}
          onDelete={deleteCategory}
          onClose={closeModal}
        />
      )}
      {modal?.kind === 'period' && (
        <PeriodForm
          value={state.period}
          recurrings={recurrings}
          accounts={accountMap}
          today={today}
          onSubmit={savePeriod}
          onClose={closeModal}
        />
      )}
      {modal?.kind === 'occurrence' && (
        <OccurrenceSheet
          entry={modal.entry}
          accountName={accounts.length > 1 ? accountMap.get(modal.entry.accountId)?.name : undefined}
          onSkip={() => skipOccurrence(modal.entry)}
          onEditRule={() => {
            const rec = recurrings.find((r) => r.id === modal.entry.recurringId);
            setModal(rec ? { kind: 'rec', rec, type: rec.type } : null);
          }}
          onClose={closeModal}
        />
      )}
      {modal?.kind === 'confirm' && (
        <ConfirmDialog {...modal} onClose={closeModal} />
      )}
      <Toast toast={toast} onDone={clearToast} />
    </>
  );

  if (!month) {
    return (
      <div className="app">
        {header}
        <main className="welcome">
          <div className="welcome__art" aria-hidden>
            <div className="acct-card acct--violet welcome__card welcome__card--back" />
            <div className="acct-card acct--emerald welcome__card welcome__card--mid" />
            <div className="acct-card acct--total welcome__card welcome__card--front">
              <div className="acct-card__label">Solde actuel</div>
              <div className="acct-card__balance">4 280,00 €</div>
              <svg viewBox="0 0 200 50" className="welcome__spark"><path d="M0 40 C 30 38, 40 20, 70 26 S 120 10, 140 18 S 180 4, 200 8" /></svg>
            </div>
          </div>
          <h1>Vos comptes, enfin lisibles.</h1>
          <p>
            Suivez vos revenus et dépenses au jour le jour, programmez votre salaire une bonne fois pour toutes et faites
            glisser les mois pour voir l’évolution de votre solde.
          </p>
          <div className="welcome__actions">
            <button className="btn btn--primary btn--lg" onClick={() => setModal({ kind: 'account' })}>
              <PlusIcon /> Créer mon premier compte
            </button>
            <button className="btn btn--ghost btn--lg" onClick={openFile}>
              <FolderIcon /> Ouvrir un fichier
            </button>
            <button className="btn btn--ghost btn--lg" onClick={loadDemo}>
              <SparkIcon /> Explorer avec la démo
            </button>
          </div>
          <p className="welcome__note">
            Vos données restent sur cet ordinateur. Enregistrez-les dans un fichier (Ctrl+S) pour les garder à l’abri
            ou les retrouver ailleurs.
          </p>
        </main>
        {modals}
      </div>
    );
  }

  const isCurrentMonth = monthIndex === todayIndex;
  const range = startDay === null ? null : periodRange(month.start, month.end);
  const periodLabel = range ? `${monthLabel(month.key)} · ${range}` : monthLabel(month.key);
  const periodButton =
    startDay === null
      ? 'Du 1er au dernier jour'
      : state.period.kind === 'rule'
        ? `D’une paie à l’autre (le ${startDay})`
        : `À partir du ${startDay} de chaque mois`;
  // Écran large : le graphique occupe la hauteur restante sous le bandeau des comptes.
  const wide = viewport.width >= 1200;
  const chartHeight = wide ? Math.round(Math.min(480, Math.max(300, viewport.height - 550))) : undefined;

  return (
    <div className="app">
      {header}
      <main className="dashboard">
        <div className="area area-carousel">
          <AccountCarousel
            items={items}
            index={selectedIndex}
            onSelect={(i) => setSelectedId(items[i].id)}
            onAdd={() => setModal({ kind: 'account' })}
            onEdit={(id) => setModal({ kind: 'account', account: accountMap.get(id) })}
            onReorder={() => setModal({ kind: 'order' })}
            onTogglePrimary={togglePrimary}
          />
        </div>

        <div className="dash-side">

          <div className="area area-qa quick-actions">
            <button className="qa qa--up" onClick={() => setModal({ kind: 'tx', type: 'income' })}>
              <span className="qa__icon"><PlusIcon /></span>
              <span><strong>Revenu</strong><small>Ajouter un gain</small></span>
            </button>
            <button className="qa qa--down" onClick={() => setModal({ kind: 'tx', type: 'expense' })}>
              <span className="qa__icon"><MinusIcon /></span>
              <span><strong>Dépense</strong><small>Ajouter une sortie</small></span>
            </button>
            <button className="qa qa--brand" onClick={() => setModal({ kind: 'rec', type: 'income' })}>
              <span className="qa__icon"><RepeatIcon /></span>
              <span><strong>Automatique</strong><small>Salaire mensuel…</small></span>
            </button>
          </div>

          <div className="area area-stats">
            <Stats month={month} today={today} periodLabel={periodLabel} accounts={accountMap} groups={groupsById} showAccount={isAll} />
          </div>

          <div className="area area-rec">
            <RecurringList
              rules={activeRules}
              accounts={accountMap}
              showAccount={isAll}
              today={today}
              onOpen={(rec) => setModal({ kind: 'rec', rec, type: rec.type })}
              onAdd={() => setModal({ kind: 'rec', type: 'income' })}
            />
          </div>
          <div className="area area-avg">
            <CategoryAverages months={months} month={month} today={today} selection={category} onSelect={setCategory} />
          </div>
        </div>

        <div className="dash-main">
          <section className="area area-chart card chart-card">
            <header className="chart-card__head">
              <div className="month-nav">
                <button className="icon-btn" onClick={() => setFocusedKey(months[Math.max(0, monthIndex - 1)].key)} disabled={monthIndex === 0} aria-label="Mois précédent">
                  <ChevronLeft />
                </button>
                <h2 aria-live="polite">
                  {monthLabel(month.key)}
                  {range && <small>{range}</small>}
                </h2>
                <button className="icon-btn" onClick={() => setFocusedKey(months[Math.min(months.length - 1, monthIndex + 1)].key)} disabled={monthIndex === months.length - 1} aria-label="Mois suivant">
                  <ChevronRight />
                </button>
                {!isCurrentMonth && (
                  <button className="btn btn--soft btn--sm" onClick={() => setFocusedKey(todayKey)}>
                    Aujourd’hui
                  </button>
                )}
              </div>
              <button className="period-btn" onClick={openPeriod} title="Choisir quand commence un mois">
                <CalendarIcon width={15} height={15} /> {periodButton}
              </button>
              <div className="legend">
                <span><i className="legend__line" /> Solde</span>
                <span title="Opérations connues (automatiques, saisies) complétées par vos habitudes des mois terminés"><i className="legend__line legend__line--dash" /> Prévision</span>
                <span><i className="legend__bar up" /> Gains</span>
                <span><i className="legend__bar down" /> Dépenses</span>
              </div>
            </header>
            <MonthStrip
              months={months}
              index={monthIndex}
              onIndexChange={(i) => setFocusedKey(months[i].key)}
              today={today}
              height={chartHeight}
            />
            <p className="chart-card__hint">Faites glisser le graphique pour changer de mois · survolez un jour pour le détail</p>
            <MonthRail months={months} index={monthIndex} today={today} onSelect={(i) => setFocusedKey(months[i].key)} />
          </section>

          <div className="dash-lower">
            <div className="area area-treemap">
              <CategoryTreemap periodLabel={periodLabel} entries={month.entries} selection={category} onSelect={setCategory} />
            </div>
            <div className="area area-ops">
              <TransactionList
                periodLabel={periodLabel}
                entries={month.entries}
                accounts={accountMap}
                showAccount={isAll}
                today={today}
                onOpen={openEntry}
                onDelete={(e) => {
                  const tx = transactions.find((t) => t.id === e.id);
                  if (tx) deleteTx(tx);
                }}
                onSkip={skipOccurrence}
                onToggleExceptional={toggleExceptional}
                groups={groupsById}
                onGroup={openGroup}
                onAdd={(type) => setModal({ kind: 'tx', type })}
                category={category}
                onClearCategory={() => setCategory(null)}
                onImport={openCsv}
              />
            </div>
          </div>
        </div>
      </main>

      <nav className="mobile-bar" aria-label="Actions rapides">
        <button className="mobile-bar__btn up" onClick={() => setModal({ kind: 'tx', type: 'income' })}><PlusIcon /> Revenu</button>
        <button className="mobile-bar__btn down" onClick={() => setModal({ kind: 'tx', type: 'expense' })}><MinusIcon /> Dépense</button>
        <button className="mobile-bar__btn brand" onClick={() => setModal({ kind: 'rec', type: 'income' })} aria-label="Opération automatique"><RepeatIcon /></button>
      </nav>

      {modals}
    </div>
  );
}
