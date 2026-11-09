import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { categoryOf } from '../lib/categories';
import { categoryAverages, ordinaryExpense, ordinaryIncome, type MonthData } from '../lib/finance';
import { money, moneyRound, monthLabel, monthName, monthShortName, signedMoneyRound } from '../lib/format';
import { usePresence } from '../lib/motion';
import type { TxType } from '../lib/types';
import type { CategorySelection } from './CategoryTreemap';

interface Props {
  /** Toutes les périodes du compte affiché. */
  months: MonthData[];
  /** Période affichée : elle est comparée à la moyenne en bas de carte. */
  month: MonthData;
  today: string;
  selection: CategorySelection | null;
  onSelect: (selection: CategorySelection | null) => void;
}

/** Fenêtres proposées, en nombre de mois (0 = tout l'historique). */
const SCOPES = [3, 6, 12, 0];
/** En dessous, le mois affiché est considéré comme égal à la moyenne. */
const SAME = 2;
/** Marge de l'encart d'information autour du pointeur, et bord de l'écran à ne pas dépasser. */
const TIP_OFFSET = 14;
const TIP_EDGE = 8;

/**
 * Moyenne par mois de chaque catégorie, sur les derniers mois terminés. La largeur de la
 * barre suit le montant ; le bas de carte compare la période affichée à cette moyenne.
 */
export function CategoryAverages({ months, month, today, selection, onSelect }: Props) {
  const [type, setType] = useState<TxType>('expense');
  const [scope, setScope] = useState(12);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const isIncome = type === 'income';

  const stats = useMemo(() => categoryAverages(months, type, today, scope), [months, type, today, scope]);
  // L'autre type : sert au bilan moyen (revenus − dépenses) du bas de carte.
  const opposite = useMemo(
    () => categoryAverages(months, isIncome ? 'expense' : 'income', today, scope),
    [months, isIncome, today, scope],
  );

  const kept = stats.months.length;
  const first = stats.months[0];
  const last = stats.months[kept - 1];
  const range =
    kept === 0 ? null
    : kept === 1 ? monthLabel(first.key)
    : `${monthShortName(first.key)} → ${monthShortName(last.key)} ${last.key.slice(0, 4)}`;

  const max = stats.categories[0]?.average ?? 0;
  const net = Math.round((isIncome ? stats.average - opposite.average : opposite.average - stats.average) * 100) / 100;

  // Période affichée : terminée (comparable), en cours, ou encore à venir (projection).
  // Comme les moyennes, elle ignore les opérations exceptionnelles.
  const shown = isIncome ? ordinaryIncome(month) : ordinaryExpense(month);
  const ongoing = month.end >= today && month.start <= today;
  const delta = month.end < today && stats.average > 0 ? Math.round((shown / stats.average - 1) * 100) : null;
  const above = delta !== null && delta > 0;
  // Dépenser plus que d'habitude est mauvais signe, gagner plus est bon signe.
  const deltaTone = above === isIncome ? 'up' : 'down';

  // Montant de chaque catégorie sur la période affichée, montré dans l'encart d'information.
  const shownByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of month.entries) {
      if (e.type !== type || e.exceptional) continue;
      map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    }
    return map;
  }, [month, type]);

  const switchType = (t: TxType) => {
    setType(t);
    setTip(null);
    if (selection && selection.type !== t) onSelect(null);
  };

  // L'encart garde sa dernière position le temps de son animation de sortie.
  const tipShown = usePresence(tip);
  const hovered = tipShown.item;
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipSize, setTipSize] = useState({ w: 214, h: 150 });
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (el && (el.offsetWidth !== tipSize.w || el.offsetHeight !== tipSize.h)) {
      setTipSize({ w: el.offsetWidth, h: el.offsetHeight });
    }
  });
  const tipGroup = hovered ? stats.categories.find((g) => g.id === hovered.id) : undefined;
  // L'encart reste dans la fenêtre : il passe à gauche du pointeur s'il n'y a plus la place à droite.
  const tipLeft = hovered
    ? hovered.x + TIP_OFFSET + tipSize.w <= window.innerWidth - TIP_EDGE
      ? hovered.x + TIP_OFFSET
      : Math.max(TIP_EDGE, hovered.x - TIP_OFFSET - tipSize.w)
    : 0;
  const tipTop = hovered
    ? Math.max(TIP_EDGE, Math.min(hovered.y + TIP_OFFSET, window.innerHeight - tipSize.h - TIP_EDGE))
    : 0;
  const moveTip = (id: string) => (e: MouseEvent<HTMLButtonElement>) => setTip({ id, x: e.clientX, y: e.clientY });

  return (
    <section className={`card averages averages--${type}`}>
      <header className="card__head">
        <div>
          <h2>Moyenne par mois</h2>
          <p className="muted">
            {kept === 0 ? 'Dès qu’un mois sera terminé' : `${kept} mois terminé${kept > 1 ? 's' : ''} · ${range}`}
          </p>
        </div>
      </header>

      {kept === 0 ? (
        <div className="empty-list">
          <div className="empty-list__art" aria-hidden>📅</div>
          <p>
            Aucun mois n’est encore terminé : la moyenne s’affichera à la fin de la période en cours. Le mois en cours et
            les prévisions n’y sont jamais comptés.
          </p>
        </div>
      ) : (
        <>
          <div className="averages__scope">
            <div className="segmented segmented--sm" role="tablist" aria-label="Type d’opérations">
              <button role="tab" aria-selected={!isIncome} className={!isIncome ? 'is-active' : ''} onClick={() => switchType('expense')}>
                Dépenses
              </button>
              <button role="tab" aria-selected={isIncome} className={isIncome ? 'is-active' : ''} onClick={() => switchType('income')}>
                Revenus
              </button>
            </div>
            <div className="chips" role="group" aria-label="Période de calcul">
              {SCOPES.map((n) => (
                <button
                  key={n}
                  className={`chip${scope === n ? ' is-active' : ''}`}
                  aria-pressed={scope === n}
                  onClick={() => {
                    setScope(n);
                    setTip(null);
                  }}
                >
                  {n === 0 ? 'Tout' : `${n} mois`}
                </button>
              ))}
            </div>
          </div>

          {stats.categories.length === 0 ? (
            <div className="empty-list">
              <div className="empty-list__art" aria-hidden>🧮</div>
              <p>
                Aucun{isIncome ? ' revenu' : 'e dépense'} sur {kept === 1 ? 'le mois terminé' : `les ${kept} derniers mois`}.
              </p>
            </div>
          ) : (
            <ul className="averages__list" onMouseLeave={() => setTip(null)}>
              {stats.categories.map((g) => {
                const cat = categoryOf(type, g.id);
                const selected = selection?.type === type && selection.id === g.id;
                const dimmed = !!selection && selection.type === type && !selected;
                return (
                  <li key={g.id}>
                    <button
                      className={`avg-row${selected ? ' is-selected' : ''}${dimmed ? ' is-dim' : ''}`}
                      aria-pressed={selected}
                      aria-label={`${cat.label} : ${money(g.average)} par mois en moyenne`}
                      onClick={() => onSelect(selected ? null : { type, id: g.id })}
                      onMouseMove={moveTip(g.id)}
                    >
                      <i className="avg-row__fill" style={{ width: `${max > 0 ? Math.max(3, Math.round((g.average / max) * 100)) : 0}%` }} aria-hidden />
                      <span className="avg-row__icon" aria-hidden>{cat.icon}</span>
                      <span className="avg-row__label">{cat.label}</span>
                      <span className="avg-row__value">{moneyRound(g.average)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <footer className="averages__foot">
            <div className="averages__foot-row is-total">
              <span>{isIncome ? 'Revenus' : 'Dépenses'} par mois</span>
              <b className={isIncome ? 'up' : 'down'}>
                {moneyRound(stats.average)} <small>en moyenne</small>
              </b>
            </div>
            <div className="averages__foot-row">
              <span>
                {monthLabel(month.key)}
                {ongoing ? ' · en cours' : month.start > today ? ' · prévu' : ''}
              </span>
              <b>
                {moneyRound(shown)}
                {delta !== null && (
                  <small className={Math.abs(delta) < SAME ? 'muted' : deltaTone}>
                    {Math.abs(delta) < SAME ? '≈ moyenne' : `${above ? '+' : '−'}${Math.abs(delta)} %`}
                  </small>
                )}
              </b>
            </div>
            <div className="averages__foot-row">
              <span>Bilan moyen</span>
              <b className={net >= 0 ? 'up' : 'down'}>
                {signedMoneyRound(net)} <small>par mois</small>
              </b>
            </div>
          </footer>
        </>
      )}

      {hovered && tipGroup &&
        createPortal(
          <div
            className="info-tip avg-tip"
            ref={tipRef}
            data-state={tipShown.state}
            style={{ left: tipLeft, top: tipTop }}
            role="status"
          >
            <strong>
              {categoryOf(type, tipGroup.id).icon} {categoryOf(type, tipGroup.id).label}
            </strong>
            <div className="info-tip__row">
              <span>Moyenne</span>
              <b>{money(tipGroup.average)}</b>
            </div>
            <div className="info-tip__row">
              <span>Total sur {kept} mois</span>
              <b>{money(tipGroup.total)}</b>
            </div>
            <div className="info-tip__row">
              <span>Opérations</span>
              <b>{tipGroup.count}</b>
            </div>
            <div className="info-tip__row">
              <span>Mois concernés</span>
              <b>{tipGroup.months} sur {kept}</b>
            </div>
            <div className="info-tip__row">
              <span>{monthName(month.key)}</span>
              <b>{money(shownByCategory.get(tipGroup.id) ?? 0)}</b>
            </div>
            <small>
              {selection?.type === type && selection.id === tipGroup.id
                ? 'Cliquer pour tout afficher'
                : 'Cliquer pour filtrer les opérations'}
            </small>
          </div>,
          document.body,
        )}
    </section>
  );
}
