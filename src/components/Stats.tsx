import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { categoryOf } from '../lib/categories';
import { ordinaryExpense, ordinaryIncome, type MonthData } from '../lib/finance';
import { dayLabel, dayMonthShort, dayShort, money, plural, round2, signedMoney } from '../lib/format';
import { DURATION, usePresence } from '../lib/motion';
import type { Account, Entry, TxGroup, TxType } from '../lib/types';
import { ArrowDownIcon, ArrowUpIcon, CalendarIcon, CheckIcon, LinkIcon, RepeatIcon, SparkIcon, TargetIcon, WalletIcon } from './Icons';

interface Props {
  month: MonthData;
  today: string;
  periodLabel: string;
  accounts: Map<string, Account>;
  /** Groupes d'opérations, par identifiant : sert à nommer le groupe d'une ligne. */
  groups: Map<string, TxGroup>;
  showAccount: boolean;
}

/** Tuile ouverte : revenus, dépenses, le bilan du mois ou celui des seuls revenus. */
type Kind = TxType | 'net' | 'salary';

const POP_WIDTH = 340;
const MARGIN = 12;
const MAX_HEIGHT = 520;
/** Écart entre la tuile et son détail. */
const GAP_X = 10;
const GAP_Y = 8;
const MIN_HEIGHT = 120;
/** Les détails s'ouvrent sur la grande courbe du compte, en retrait de son bord. */
const ZONE = '.area-chart';
const ZONE_PAD = 14;

/**
 * Par défaut, la tuile « Revenus » ne compte que les salaires et la tuile « Dépenses » tout le
 * reste — sauf les opérations marquées exceptionnelles, qui ne comptent jamais d'elles-mêmes.
 */
const countedByDefault = (e: Entry) =>
  e.exceptional || e.budget === 0 ? false
  : e.budgetType === 'income' ? e.category === 'salaire'
  : true;
/** Le bilan, lui, compte tous les revenus (pas seulement les salaires), mais pas les exceptionnels. */
const inNetByDefault = (e: Entry) => !e.exceptional && e.budget !== 0;
/** Côté où ranger l'opération : son montant retenu, ou son sens réel si elle ne compte pas. */
const sideOf = (e: Entry) => (e.budget === 0 ? e.type : e.budgetType);
/** Montant à afficher : celui qui compte, ou le montant réel d'une opération qui ne compte pas. */
const shownAmount = (e: Entry) => (e.budget === 0 ? e.amount : e.budget);
const sum = (list: Entry[]) => round2(list.reduce((s, e) => s + e.budget, 0));
const byDate = (a: Entry, b: Entry) => (a.date === b.date ? b.amount - a.amount : a.date < b.date ? -1 : 1);

export function Stats({ month, today, periodLabel, accounts, groups, showAccount }: Props) {
  // Les indicateurs raisonnent sur l'ordinaire ; les soldes, eux, comptent tout.
  const income = ordinaryIncome(month);
  const expense = ordinaryExpense(month);
  const net = round2(income - expense);
  const oneOffNet = round2(month.oneOffIncome - month.oneOffExpense);
  const realNet = round2(month.income - month.expense);
  const todayPoint = month.days.find((d) => d.date === today);
  const isFuture = month.start > today;
  const savingsRate = income > 0 ? Math.round((net / income) * 100) : null;
  // Solde de fin de période : la prévision complète les opérations connues (voir applyForecast).
  const estimated = month.estClosing !== month.closingBalance;

  const incomes = month.entries.filter((e) => sideOf(e) === 'income');
  const expenses = month.entries.filter((e) => sideOf(e) === 'expense');
  const salaries = incomes.filter(countedByDefault);
  const salaryTotal = sum(salaries);
  // Revenus hors salaires listés dans le détail (les exceptionnels en font partie)…
  const otherIncome = round2(sum(incomes) - salaryTotal);
  // … et la part d'entre eux qui entre dans le bilan.
  const otherOrdinary = round2(income - salaryTotal);
  const oneOffs = month.entries.filter((e) => e.exceptional && e.budget !== 0);
  // Part du mois absorbée par les groupes : ce que le solde a bougé sans entrer dans le bilan.
  const groupedNet = round2(realNet - net - oneOffNet);

  // Opérations (dés)activées à la main dans le détail : choix temporaires, remis à zéro
  // dès que le mois affiché change. Rien n'est enregistré, les données restent intactes.
  const [picks, setPicks] = useState<Map<string, boolean>>(new Map());
  // Déjà vide au montage : inutile d'en reposer une neuve, ce serait un rendu de plus.
  useEffect(() => setPicks((prev) => (prev.size ? new Map() : prev)), [month]);
  const counted = (e: Entry) => picks.get(e.id) ?? countedByDefault(e);
  const toggle = (e: Entry) =>
    e.budget === 0 ||
    setPicks((prev) => {
      const next = new Map(prev);
      const value = !counted(e);
      if (value === countedByDefault(e)) next.delete(e.id);
      else next.set(e.id, value);
      return next;
    });
  const reset = useCallback(() => setPicks(new Map()), []);
  /** Entre-t-elle dans le bilan, choix manuels compris ? */
  const inNet = (e: Entry) => picks.get(e.id) ?? inNetByDefault(e);
  /** Opérations retirées du bilan à la main, et exceptionnelles qu'on y a remises. */
  const dropped = month.entries.filter((e) => inNetByDefault(e) && !inNet(e));
  const added = month.entries.filter((e) => !inNetByDefault(e) && inNet(e));

  const countedIncomes = incomes.filter(counted);
  const countedExpenses = expenses.filter(counted);
  const incomeTotal = sum(countedIncomes);
  const expenseTotal = sum(countedExpenses);
  const incomeCount = countedIncomes.length;
  const expenseCount = countedExpenses.length;
  // Bilan des seuls revenus comptés : la soustraction des deux tuiles, choix manuels compris.
  const salaryNet = round2(incomeTotal - expenseTotal);
  // Un choix sur les dépenses ne change pas le libellé de la tuile des revenus, et inversement.
  const touchedIn = incomes.some((e) => picks.has(e.id));
  const touchedEx = expenses.some((e) => picks.has(e.id));
  const netPicked = round2(sum(incomes.filter(inNet)) - sum(expenses.filter(inNet)));

  // Détail au survol (souris), au focus (clavier) ou au toucher.
  const [detail, setDetail] = useState<{ kind: Kind; anchor: HTMLElement } | null>(null);
  const timer = useRef(0);
  const popRef = useRef<HTMLDivElement>(null);
  const pointerType = useRef('mouse');
  const schedule = (fn: () => void, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, delay);
  };
  // Petits délais d'intention : un simple passage de la souris n'ouvre ni ne ferme rien.
  const open = (kind: Kind, anchor: HTMLElement, delay: number = DURATION.fast) =>
    schedule(() => setDetail({ kind, anchor }), delay);
  const close = (delay: number = DURATION.fast) => schedule(() => setDetail(null), delay);
  const toggleOpen = (kind: Kind, anchor: HTMLElement) =>
    schedule(() => setDetail((d) => (d?.kind === kind ? null : { kind, anchor })), 0);
  const closeNow = useCallback(() => setDetail(null), []);

  useEffect(() => {
    if (!detail) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node && (detail.anchor.contains(target) || !!popRef.current?.contains(target));
    // Le détail s'affiche sur la courbe, loin de sa tuile : le rectangle qui joint les deux
    // compte comme « dedans », sinon il se fermerait pendant le trajet de la souris.
    const corridor = (e: MouseEvent) => {
      const pop = popRef.current;
      if (!pop) return false;
      const a = detail.anchor.getBoundingClientRect();
      const p = pop.getBoundingClientRect();
      return (
        e.clientX >= Math.min(a.left, p.left) - 2 && e.clientX <= Math.max(a.right, p.right) + 2 &&
        e.clientY >= Math.min(a.top, p.top) - 2 && e.clientY <= Math.max(a.bottom, p.bottom) + 2
      );
    };
    // On ne ferme que si la souris a réellement bougé hors de la tuile et du détail :
    // la molette fait défiler la page sans déplacer le pointeur, le détail reste donc ouvert.
    let last = { x: NaN, y: NaN };
    const onMove = (e: MouseEvent) => {
      if (e.screenX === last.x && e.screenY === last.y) return;
      last = { x: e.screenX, y: e.screenY };
      if (inside(e.target) || corridor(e)) window.clearTimeout(timer.current);
      // Sur l'autre tuile : c'est son propre survol qui ouvre son détail.
      else if (!(e.target instanceof Element && e.target.closest('.stat--interactive'))) close();
    };
    // Pointeur sorti de la fenêtre : plus aucun mousemove n'arrivera, on ferme.
    const onLeavePage = () => close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDetail(null);
    const onPointer = (e: PointerEvent) => !inside(e.target) && setDetail(null);
    document.documentElement.addEventListener('mouseleave', onLeavePage);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      document.documentElement.removeEventListener('mouseleave', onLeavePage);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
    // close() ne dépend que de refs et de setDetail : inutile de relancer l'effet pour lui.
  }, [detail]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Le détail reste affiché le temps de son animation de sortie.
  const presence = usePresence(detail);
  const shown = presence.item;

  const tile = (kind: Kind, label: string, children: ReactNode) => (
    <div
      className={`stat stat--${
        kind === 'income' ? 'up'
        : kind === 'expense' ? 'down'
        : (kind === 'salary' ? salaryNet : net) >= 0 ? 'up'
        : 'down'
      } stat--interactive${detail?.kind === kind ? ' is-open' : ''}`}
      tabIndex={0}
      role="button"
      aria-expanded={detail?.kind === kind}
      aria-label={label}
      onMouseEnter={(e) => open(kind, e.currentTarget)}
      onMouseLeave={() => {
        // Simple passage sur la tuile : on annule l'ouverture prévue.
        if (!detail) window.clearTimeout(timer.current);
      }}
      // Seulement au clavier : un focus laissé par un clic ne doit pas rouvrir le détail
      // (par exemple en revenant sur la fenêtre alors que la souris est ailleurs).
      onFocus={(e) => e.currentTarget.matches(':focus-visible') && open(kind, e.currentTarget, 0)}
      onBlur={(e) => {
        // Un clic dans le détail retire le focus de la tuile : on le garde ouvert.
        const pop = popRef.current;
        if (pop?.contains(e.relatedTarget as Node) || pop?.matches(':hover')) return;
        close();
      }}
      onPointerDown={(e) => (pointerType.current = e.pointerType)}
      onClick={(e) => {
        // Souris : le survol l'a déjà ouvert, le clic le garde ouvert. Tactile : le toucher bascule.
        if (pointerType.current === 'mouse') open(kind, e.currentTarget, 0);
        else toggleOpen(kind, e.currentTarget);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleOpen(kind, e.currentTarget);
        }
      }}
    >
      {children}
    </div>
  );

  return (
    <div className="stats">
      {tile(
        'income',
        'Voir le détail des revenus',
        <>
          <span className="stat__icon"><ArrowUpIcon /></span>
          <span className="stat__label">Revenus</span>
          <strong className="stat__value">{money(incomeTotal)}</strong>
          <span className="stat__hint">
            {touchedIn ? (
              `${incomeCount} comptée${plural(incomeCount)} sur ${incomes.length}`
            ) : (
              <>
                {salaries.length} salaire{plural(salaries.length)}
                {otherIncome > 0 ? ` · autres : ${signedMoney(otherIncome)}` : ' · voir le détail'}
              </>
            )}
          </span>
        </>,
      )}
      {tile(
        'expense',
        'Voir le détail des dépenses',
        <>
          <span className="stat__icon"><ArrowDownIcon /></span>
          <span className="stat__label">Dépenses</span>
          <strong className="stat__value">{money(expenseTotal)}</strong>
          <span className="stat__hint">
            {touchedEx || month.oneOffExpense > 0 || groupedNet !== 0
              ? `${expenseCount} comptée${plural(expenseCount)} sur ${expenses.length}`
              : `${expenses.length} opération(s) · voir le détail`}
          </span>
        </>,
      )}
      {tile(
        'net',
        'Voir le détail du calcul du bilan',
        <>
          <span className="stat__icon"><TargetIcon /></span>
          <span className="stat__label">Bilan du mois</span>
          <strong className="stat__value">{signedMoney(net)}</strong>
          <span className="stat__hint">
            {oneOffNet !== 0
              ? `${signedMoney(oneOffNet)} hors bilan`
              : savingsRate !== null
                ? `${savingsRate} % des revenus épargnés`
                : 'Aucun revenu ce mois-ci'}
          </span>
        </>,
      )}
      {tile(
        'salary',
        'Voir le détail du bilan de vos revenus',
        <>
          <span className="stat__icon"><WalletIcon /></span>
          <span className="stat__label">Bilan des revenus</span>
          <strong className="stat__value">{signedMoney(salaryNet)}</strong>
          <span className="stat__hint">
            {otherIncome > 0 ? 'salaires seuls − dépenses' : 'revenus − dépenses'}
          </span>
        </>,
      )}
      <div className="stat stat--brand">
        <span className="stat__icon"><CalendarIcon /></span>
        {todayPoint ? (
          <>
            <span className="stat__label">Solde aujourd’hui</span>
            <strong className="stat__value">{money(todayPoint.balance)}</strong>
            <span className="stat__hint">
              Fin de mois {estimated ? 'estimée' : 'prévue'} : {money(month.estClosing)}
            </span>
          </>
        ) : (
          <>
            <span className="stat__label">{isFuture ? 'Solde prévu' : 'Solde fin de mois'}</span>
            <strong className="stat__value">{money(month.estClosing)}</strong>
            <span className="stat__hint">
              au {dayShort(month.end)} · début : {money(month.estOpening)}
            </span>
          </>
        )}
      </div>

      {shown && shown.kind === 'net' && (
        <BalancePopover
          state={presence.state}
          popRef={popRef}
          anchor={shown.anchor}
          month={month}
          today={today}
          periodLabel={periodLabel}
          income={income}
          expense={expense}
          net={net}
          salaryTotal={salaryTotal}
          otherIncome={otherOrdinary}
          oneOffs={oneOffs}
          oneOffNet={oneOffNet}
          groupedNet={groupedNet}
          realNet={realNet}
          savingsRate={savingsRate}
          dropped={dropped}
          added={added}
          netPicked={netPicked}
          onReset={reset}
          onClose={closeNow}
        />
      )}
      {shown && shown.kind === 'salary' && (
        <SalaryPopover
          state={presence.state}
          popRef={popRef}
          anchor={shown.anchor}
          periodLabel={periodLabel}
          incomeTotal={incomeTotal}
          expenseTotal={expenseTotal}
          salaryNet={salaryNet}
          otherIncome={otherOrdinary}
          touched={touchedIn || touchedEx}
          onReset={reset}
          onClose={closeNow}
        />
      )}
      {shown && (shown.kind === 'income' || shown.kind === 'expense') && (
        <DetailPopover
          key={shown.kind}
          state={presence.state}
          popRef={popRef}
          anchor={shown.anchor}
          title={shown.kind === 'income' ? 'Revenus' : 'Dépenses'}
          side={shown.kind === 'income' ? 'left' : 'right'}
          groupByDay={shown.kind === 'expense'}
          type={shown.kind}
          entries={(shown.kind === 'income' ? salaries : expenses.filter(countedByDefault)).slice().sort(byDate)}
          total={shown.kind === 'income' ? incomeTotal : expenseTotal}
          others={(shown.kind === 'income' ? incomes : expenses).filter((e) => !countedByDefault(e)).sort(byDate)}
          othersLabel={shown.kind === 'income' ? 'Autres revenus' : 'Dépenses non comptées'}
          groups={groups}
          counted={counted}
          onToggle={toggle}
          touched={shown.kind === 'income' ? touchedIn : touchedEx}
          onReset={reset}
          today={today}
          periodLabel={periodLabel}
          accounts={accounts}
          showAccount={showAccount}
          onClose={closeNow}
        />
      )}
    </div>
  );
}

interface Placement {
  left: number;
  top: number;
  maxHeight: number;
}

/**
 * La grande courbe du compte, quand elle peut accueillir le détail : c'est là qu'il
 * s'ouvre, toujours au même endroit. Renvoie null sur les écrans étroits (la courbe
 * n'est plus à côté des tuiles) ou si elle est sortie de l'écran.
 */
function chartZone(a: DOMRect, width: number, vh: number): DOMRect | null {
  const el = document.querySelector(ZONE);
  if (!el) return null;
  const z = el.getBoundingClientRect();
  const beside = z.left >= a.right - 1;
  const large = z.width >= width + ZONE_PAD * 2;
  const visible = z.bottom > MARGIN && z.top < vh - MARGIN;
  return beside && large && visible ? z : null;
}

/**
 * Place le détail sur la courbe du compte. À défaut (écran étroit), à côté de sa tuile :
 * du côté demandé s'il y a la place, sinon dessous (ou dessus), toujours dans l'écran.
 * Il suit la tuile quand la page défile, et se ferme si elle sort de l'écran.
 */
function usePlacement(
  popRef: RefObject<HTMLDivElement | null>,
  anchor: HTMLElement,
  side: 'left' | 'right',
  onClose: () => void,
  signature: string,
): Placement | null {
  const [pos, setPos] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const el = popRef.current;
      if (!el) return;
      const a = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // La tuile est sortie de l'écran en faisant défiler : le détail n'a plus de sens.
      if (a.bottom < 0 || a.top > vh) return onClose();
      // Hauteur naturelle, sans la limite appliquée au placement précédent.
      const scroller = el.querySelector<HTMLElement>('.detail-pop__scroll');
      const natural = scroller ? el.offsetHeight - scroller.clientHeight + scroller.scrollHeight : el.offsetHeight;
      const width = Math.min(POP_WIDTH, vw - MARGIN * 2);
      const cap = Math.min(vh - MARGIN * 2, MAX_HEIGHT);
      const fits = side === 'left' ? a.left - GAP_X - width >= MARGIN : a.right + GAP_X + width <= vw - MARGIN;
      const zone = chartZone(a, width, vh);
      let left: number;
      let top: number;
      let maxHeight = cap;
      if (zone) {
        // Sur la courbe, contre son bord gauche, à la hauteur de la tuile survolée.
        const h = Math.min(natural, cap);
        left = Math.min(Math.max(MARGIN, zone.left + ZONE_PAD), vw - MARGIN - width);
        top = Math.min(Math.max(MARGIN, a.top), vh - MARGIN - h);
        // Assez de place en hauteur : on le garde entièrement sur la courbe.
        if (zone.height >= h + ZONE_PAD * 2) top = Math.min(Math.max(top, zone.top + ZONE_PAD), zone.bottom - ZONE_PAD - h);
      } else if (fits) {
        // Sur le côté demandé, aligné sur le haut de la tuile.
        left = side === 'left' ? a.left - GAP_X - width : a.right + GAP_X;
        top = Math.min(Math.max(MARGIN, a.top), vh - MARGIN - Math.min(natural, cap));
      } else {
        // Pas la place sur le côté : dessous (ou dessus), calé du côté demandé.
        left = side === 'left' ? a.right - width : a.left;
        left = Math.min(Math.max(MARGIN, left), vw - MARGIN - width);
        const below = vh - MARGIN - (a.bottom + GAP_Y);
        const above = a.top - GAP_Y - MARGIN;
        if (natural <= below || below >= above) {
          maxHeight = Math.max(MIN_HEIGHT, Math.min(cap, below));
          top = a.bottom + GAP_Y;
        } else {
          maxHeight = Math.max(MIN_HEIGHT, Math.min(cap, above));
          top = a.top - GAP_Y - Math.min(natural, maxHeight);
        }
      }
      setPos((prev) =>
        prev && prev.left === left && prev.top === top && prev.maxHeight === maxHeight ? prev : { left, top, maxHeight },
      );
    };
    place();
    // Le détail suit la tuile quand la page défile.
    let raf = 0;
    const onScroll = (e: Event) => {
      // Défilement de la liste du détail : rien à repositionner. (Au redimensionnement, la cible est window.)
      if (e.target instanceof Node && popRef.current?.contains(e.target)) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [anchor, side, signature, popRef, onClose]);

  return pos;
}

const hiddenStyle = { visibility: 'hidden', left: 0, top: 0 } as const;

interface PopoverProps {
  popRef: RefObject<HTMLDivElement | null>;
  /** « closed » pendant l'animation de sortie. */
  state: 'open' | 'closed';
  anchor: HTMLElement;
  title: string;
  /** Côté où ouvrir le détail ; faute de place, il s'ouvre dessous en restant de ce côté. */
  side: 'left' | 'right';
  /** Regrouper les opérations par jour, avec le total de chaque jour. */
  groupByDay: boolean;
  type: TxType;
  entries: Entry[];
  total: number;
  /** Opérations du même type non comptées par défaut (revenus hors salaire, exceptionnelles). */
  others: Entry[];
  /** Titre de leur section, ex. « Autres revenus ». */
  othersLabel: string;
  groups: Map<string, TxGroup>;
  /** L'opération entre-t-elle dans le total ? */
  counted: (e: Entry) => boolean;
  onToggle: (e: Entry) => void;
  /** Au moins une opération a été (dé)cochée à la main. */
  touched: boolean;
  onReset: () => void;
  today: string;
  periodLabel: string;
  accounts: Map<string, Account>;
  showAccount: boolean;
  onClose: () => void;
}

/** Opérations triées par date → groupes par jour avec le total de celles qui comptent. */
function groupDays(entries: Entry[], counted: (e: Entry) => boolean) {
  const days: { date: string; list: Entry[]; sum: number }[] = [];
  for (const e of entries) {
    const add = counted(e) ? e.budget : 0;
    const last = days[days.length - 1];
    if (last?.date === e.date) {
      last.list.push(e);
      last.sum = round2(last.sum + add);
    } else days.push({ date: e.date, list: [e], sum: add });
  }
  return days;
}

/** Liste des opérations qui composent le total, collée à la tuile et gardée dans l'écran. */
function DetailPopover({
  popRef,
  state,
  anchor,
  title,
  side,
  groupByDay,
  type,
  entries,
  total,
  others,
  othersLabel,
  groups,
  counted,
  onToggle,
  touched,
  onReset,
  today,
  periodLabel,
  accounts,
  showAccount,
  onClose,
}: PopoverProps) {
  const isIncome = type === 'income';
  const pos = usePlacement(popRef, anchor, side, onClose, `${groupByDay}-${entries.length}-${others.length}`);
  const kept = [...entries, ...others].filter(counted).length;
  const all = entries.length + others.length;

  const row = (e: Entry, showDate = true) => {
    const cat = categoryOf(e.type, e.category);
    const acct = accounts.get(e.accountId);
    const on = counted(e);
    const group = e.groupId ? groups.get(e.groupId) : undefined;
    // Une opération secondaire ne compte jamais ici : son montant est porté par le groupe.
    const locked = e.budget === 0;
    const classes = [e.date > today ? 'is-future' : '', on ? '' : 'is-excluded'].filter(Boolean).join(' ');
    return (
      <li key={e.id} className={classes || undefined}>
        <button
          className="detail-pop__row"
          aria-pressed={locked ? undefined : on}
          disabled={locked}
          title={
            locked ? `Secondaire dans « ${group?.label ?? 'un groupe'} » : son montant est porté par l’opération principale`
            : on ? 'Retirer du total'
            : 'Compter dans le total'
          }
          onClick={() => onToggle(e)}
        >
          {showDate && <span className="detail-pop__date">{dayMonthShort(e.date)}</span>}
          <span className="detail-pop__icon" aria-hidden>{cat.icon}</span>
          <span className="detail-pop__text">
            <span className="detail-pop__label">{e.label}</span>
            <span className="detail-pop__meta">
              {cat.label}
              {e.recurringId && <RepeatIcon width={11} height={11} aria-label="Automatique" />}
              {group && (
                <span className="badge badge--group">
                  <LinkIcon width={11} height={11} /> {locked ? 'Secondaire' : group.label}
                </span>
              )}
              {e.exceptional && (
                <span className="badge badge--odd"><SparkIcon width={11} height={11} /> Exceptionnel</span>
              )}
              {e.date > today && <span className="badge">Prévu</span>}
              {showAccount && acct && <span className={`badge badge--acct acct--${acct.color}`}>{acct.name}</span>}
            </span>
          </span>
          <span className={`detail-pop__amount ${sideOf(e) === 'income' ? 'up' : 'down'}`}>
            {signedMoney(sideOf(e) === 'income' ? shownAmount(e) : -shownAmount(e))}
          </span>
          <span className="detail-pop__pick" aria-hidden>{on && <CheckIcon width={11} height={11} />}</span>
        </button>
      </li>
    );
  };

  return createPortal(
    <div
      ref={popRef}
      className={`detail-pop detail-pop--${type}`}
      data-state={state}
      style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : hiddenStyle}
      role="dialog"
      aria-label={`Détail : ${title}`}
    >
      <header className="detail-pop__head">
        <div>
          <strong>{title}</strong>
          <span>{periodLabel}</span>
        </div>
        <b className={isIncome ? 'up' : 'down'}>{signedMoney(isIncome ? total : -total)}</b>
      </header>
      <div className="detail-pop__scroll">
        {entries.length === 0 ? (
          <p className="detail-pop__empty">
            {isIncome ? 'Aucun salaire sur cette période.' : 'Aucune dépense ordinaire sur cette période.'}
          </p>
        ) : groupByDay ? (
          <div className="detail-pop__days">
            {groupDays(entries, counted).map(({ date, list, sum: daySum }) => (
              <section key={date} className={`detail-pop__day${date > today ? ' is-future' : ''}`}>
                <div className="detail-pop__day-head">
                  <span>{date === today ? 'Aujourd’hui' : dayLabel(date)}</span>
                  <span className={`tx-group__total ${isIncome ? 'up' : 'down'}`}>
                    <small>Total</small> {signedMoney(isIncome ? daySum : -daySum)}
                  </span>
                </div>
                <ul className="detail-pop__list">{list.map((e) => row(e, false))}</ul>
              </section>
            ))}
          </div>
        ) : (
          <ul className="detail-pop__list">{entries.map((e) => row(e))}</ul>
        )}
        {others.length > 0 && (
          <>
            <div className="detail-pop__section">
              {othersLabel}
              {others.some((e) => e.budget !== 0) && ' · cliquer pour les compter'}
            </div>
            <ul className="detail-pop__list">{others.map((e) => row(e))}</ul>
          </>
        )}
      </div>
      <footer className="detail-pop__foot">
        <span>
          {touched ? `${kept} comptée${plural(kept)} sur ${all}` : `${all} opération${plural(all)}`}
          {!touched && <small>Cliquez une ligne pour la compter ou non</small>}
        </span>
        {touched && (
          <button className="detail-pop__reset" onClick={onReset}>
            Réinitialiser
          </button>
        )}
      </footer>
    </div>,
    document.body,
  );
}

interface BalanceProps {
  popRef: RefObject<HTMLDivElement | null>;
  state: 'open' | 'closed';
  anchor: HTMLElement;
  month: MonthData;
  today: string;
  periodLabel: string;
  /** Totaux et bilan hors opérations exceptionnelles. */
  income: number;
  expense: number;
  net: number;
  salaryTotal: number;
  /** Revenus hors salaires qui entrent dans le bilan (exceptionnels exclus). */
  otherIncome: number;
  /** Opérations mises de côté parce qu'exceptionnelles. */
  oneOffs: Entry[];
  oneOffNet: number;
  /** Part du mois absorbée par les groupes (remboursements…), hors bilan mais dans le solde. */
  groupedNet: number;
  /** Variation réelle du solde : tout compris. */
  realNet: number;
  savingsRate: number | null;
  /** Opérations retirées du bilan à la main, et exceptionnelles qu'on y a remises. */
  dropped: Entry[];
  added: Entry[];
  netPicked: number;
  onReset: () => void;
  onClose: () => void;
}

/** Comment le bilan du mois est calculé, ligne par ligne. */
function BalancePopover({
  popRef,
  state,
  anchor,
  month,
  today,
  periodLabel,
  income,
  expense,
  net,
  salaryTotal,
  otherIncome,
  oneOffs,
  oneOffNet,
  groupedNet,
  realNet,
  savingsRate,
  dropped,
  added,
  netPicked,
  onReset,
  onClose,
}: BalanceProps) {
  const pos = usePlacement(popRef, anchor, 'left', onClose, `net-${dropped.length}-${added.length}-${oneOffs.length}`);
  // Les exceptionnelles sont hors bilan : elles ne comptent pas non plus dans le « à venir ».
  const ahead = month.entries.filter((e) => e.date > today && !e.exceptional);
  const aheadNet = round2(ahead.reduce((s, e) => s + (e.type === 'income' ? e.amount : -e.amount), 0));
  const touched = dropped.length > 0 || added.length > 0;
  const picksLabel =
    dropped.length && added.length ? 'Bilan avec vos choix'
    : added.length ? `Avec ${added.length === 1 ? 'l’opération remise' : `les ${added.length} opérations remises`}`
    : dropped.length === 1 ? 'Sans l’opération retirée'
    : `Sans les ${dropped.length} opérations retirées`;

  return createPortal(
    <div
      ref={popRef}
      className="detail-pop detail-pop--net"
      data-state={state}
      style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : hiddenStyle}
      role="dialog"
      aria-label="Détail : bilan du mois"
    >
      <header className="detail-pop__head">
        <div>
          <strong>Bilan du mois</strong>
          <span>{periodLabel}</span>
        </div>
        <b className={net >= 0 ? 'up' : 'down'}>{signedMoney(net)}</b>
      </header>
      <div className="detail-pop__scroll">
        <div className="calc">
          <div className="calc__row">
            <span>Revenus</span>
            <b className="up">{signedMoney(income)}</b>
          </div>
          <div className="calc__sub">
            <span>dont salaires</span>
            <b className="up">{money(salaryTotal)}</b>
          </div>
          {otherIncome > 0 && (
            <div className="calc__sub">
              <span>dont autres revenus</span>
              <b className="up">{money(otherIncome)}</b>
            </div>
          )}
          <div className="calc__row">
            <span>Dépenses</span>
            <b className="down">{signedMoney(-expense)}</b>
          </div>
          <div className="calc__row calc__row--total">
            <span>Bilan</span>
            <b className={net >= 0 ? 'up' : 'down'}>{signedMoney(net)}</b>
          </div>
          {ahead.length > 0 && (
            <div className="calc__sub">
              <span>dont {ahead.length} opération{plural(ahead.length)} à venir</span>
              <b className={aheadNet >= 0 ? 'up' : 'down'}>{signedMoney(aheadNet)}</b>
            </div>
          )}

          {oneOffs.length > 0 && (
            <div className="calc__row calc__row--alt">
              <span>
                {oneOffs.length} opération{plural(oneOffs.length)} exceptionnelle{plural(oneOffs.length)}
              </span>
              <b className={oneOffNet >= 0 ? 'up' : 'down'}>{signedMoney(oneOffNet)}</b>
            </div>
          )}
          {groupedNet !== 0 && (
            <div className={`calc__row${oneOffs.length > 0 ? '' : ' calc__row--alt'}`}>
              <span>Opérations regroupées</span>
              <b className={groupedNet >= 0 ? 'up' : 'down'}>{signedMoney(groupedNet)}</b>
            </div>
          )}
          {(oneOffs.length > 0 || groupedNet !== 0) && (
            <div className="calc__sub">
              <span>hors bilan, mais bien dans le solde</span>
              <b className={realNet >= 0 ? 'up' : 'down'}>solde : {signedMoney(realNet)}</b>
            </div>
          )}

          {touched && (
            <div className="calc__row calc__row--alt">
              <span>{picksLabel}</span>
              <b className={netPicked >= 0 ? 'up' : 'down'}>{signedMoney(netPicked)}</b>
            </div>
          )}
          <p className="calc__note">
            {savingsRate === null ? (
              'Taux d’épargne : aucun revenu sur cette période.'
            ) : (
              <>
                Taux d’épargne = bilan ÷ revenus = {signedMoney(net)} ÷ {money(income)} ={' '}
                <b className={savingsRate >= 0 ? 'up' : 'down'}>
                  {savingsRate < 0 ? `−${Math.abs(savingsRate)}` : savingsRate} %
                </b>
              </>
            )}
          </p>
          <p className="calc__note calc__note--soft">
            Ce bilan compte tous les revenus de la période, salaires et autres revenus confondus. Pour ne
            garder que les salaires, voyez la tuile « Bilan des revenus ».
          </p>
        </div>
      </div>
      {touched && (
        <footer className="detail-pop__foot">
          <span>
            {dropped.length > 0 && `${dropped.length} retirée${plural(dropped.length)}`}
            {dropped.length > 0 && added.length > 0 && ' · '}
            {added.length > 0 && `${added.length} remise${plural(added.length)}`}
            {' du calcul'}
          </span>
          <button className="detail-pop__reset" onClick={onReset}>
            Réinitialiser
          </button>
        </footer>
      )}
    </div>,
    document.body,
  );
}

interface SalaryProps {
  popRef: RefObject<HTMLDivElement | null>;
  state: 'open' | 'closed';
  anchor: HTMLElement;
  periodLabel: string;
  /** Les deux tuiles du dessus, choix manuels compris. */
  incomeTotal: number;
  expenseTotal: number;
  salaryNet: number;
  /** Revenus hors salaires : ils n'entrent pas dans ce bilan-ci. */
  otherIncome: number;
  touched: boolean;
  onReset: () => void;
  onClose: () => void;
}

/** Bilan des seuls revenus comptés : ce qu'il reste une fois les dépenses payées. */
function SalaryPopover({
  popRef,
  state,
  anchor,
  periodLabel,
  incomeTotal,
  expenseTotal,
  salaryNet,
  otherIncome,
  touched,
  onReset,
  onClose,
}: SalaryProps) {
  const pos = usePlacement(popRef, anchor, 'right', onClose, `salary-${touched}`);

  return createPortal(
    <div
      ref={popRef}
      className="detail-pop detail-pop--net"
      data-state={state}
      style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : hiddenStyle}
      role="dialog"
      aria-label="Détail : bilan des revenus"
    >
      <header className="detail-pop__head">
        <div>
          <strong>Bilan des revenus</strong>
          <span>{periodLabel}</span>
        </div>
        <b className={salaryNet >= 0 ? 'up' : 'down'}>{signedMoney(salaryNet)}</b>
      </header>
      <div className="detail-pop__scroll">
        <div className="calc">
          <div className="calc__row">
            <span>Revenus</span>
            <b className="up">{signedMoney(incomeTotal)}</b>
          </div>
          <div className="calc__row">
            <span>Dépenses</span>
            <b className="down">{signedMoney(-expenseTotal)}</b>
          </div>
          <div className="calc__row calc__row--total">
            <span>{salaryNet >= 0 ? 'Il vous reste' : 'Il vous manque'}</span>
            <b className={salaryNet >= 0 ? 'up' : 'down'}>{signedMoney(salaryNet)}</b>
          </div>
          <p className="calc__note">
            Ce bilan est la soustraction des deux tuiles « Revenus » et « Dépenses » : ce qu’il vous reste
            une fois vos dépenses payées, en ne comptant que vos salaires.
            {otherIncome > 0 && ' Allocations, remboursements et autres revenus n’y entrent pas.'}
          </p>
          {touched && (
            <p className="calc__note calc__note--soft">
              Vos choix dans le détail des revenus et des dépenses sont repris ici.
            </p>
          )}
        </div>
      </div>
      {touched && (
        <footer className="detail-pop__foot">
          <span>Calcul modifié à la main</span>
          <button className="detail-pop__reset" onClick={onReset}>
            Réinitialiser
          </button>
        </footer>
      )}
    </div>,
    document.body,
  );
}
