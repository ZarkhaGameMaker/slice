import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { categoryOf } from '../lib/categories';
import { money, plural } from '../lib/format';
import { useElementSize, usePresence } from '../lib/motion';
import { squarify } from '../lib/treemap';
import type { Entry, TxType } from '../lib/types';
import { TypeTabs } from './TypeTabs';

export interface CategorySelection {
  type: TxType;
  id: string;
}

interface Props {
  periodLabel: string;
  entries: Entry[];
  selection: CategorySelection | null;
  onSelect: (selection: CategorySelection | null) => void;
}

interface Group {
  id: string;
  amount: number;
  count: number;
}

/** Marge de l'infobulle autour du pointeur. */
const TIP_OFFSET = 14;
/**
 * Espace entre deux catégories, et entre une catégorie et le bord. C'est un vrai vide (le fond de
 * la carte apparaît) : pas de bordure opaque qui se verrait dans le halo ou pendant les animations.
 */
const GAP = 6;
/** En dessous, une tuile garde tout de même un filet de 2 px pour rester visible. */
const MIN_SIZE = 2;

/** Position et taille d'une tuile dans sa case, une fois l'espacement retiré. */
function inset(pos: number, size: number): [number, number] | null {
  if (size - GAP >= MIN_SIZE) return [pos + GAP / 2, size - GAP];
  if (size >= MIN_SIZE) return [pos + (size - MIN_SIZE) / 2, MIN_SIZE];
  return null;
}

const pctLabel = (share: number) => {
  if (share > 0 && share < 0.001) return '< 0,1';
  return (share >= 0.1 ? Math.round(share * 100) : Math.round(share * 1000) / 10).toLocaleString('fr-FR');
};

/**
 * Répartition du mois par catégorie : chaque tuile a une surface proportionnelle au montant.
 * La teinte est celle du type (dépense / revenu) ; son intensité suit le montant.
 */
export function CategoryTreemap({ periodLabel, entries, selection, onSelect }: Props) {
  const [type, setType] = useState<TxType>(selection?.type ?? 'expense');
  // Hauteur fixée en CSS (.treemap__canvas) : filtrer les opérations ne redessine pas les carrés.
  const [canvasRef, { width, height }] = useElementSize<HTMLDivElement>();
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipSize, setTipSize] = useState({ w: 200, h: 130 });
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (el && (el.offsetWidth !== tipSize.w || el.offsetHeight !== tipSize.h)) {
      setTipSize({ w: el.offsetWidth, h: el.offsetHeight });
    }
  });

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const e of entries) {
      // Montant retenu : une opération secondaire d'un groupe ne gonfle pas sa catégorie.
      if (e.budgetType !== type || e.budget === 0) continue;
      const g = map.get(e.category);
      if (g) {
        g.amount += e.budget;
        g.count++;
      } else map.set(e.category, { id: e.category, amount: e.budget, count: 1 });
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [entries, type]);

  const total = groups.reduce((s, g) => s + g.amount, 0);
  const max = groups[0]?.amount ?? 1;
  const rects = useMemo(
    // Cadre réduit d'un demi-espace : le bord extérieur a ainsi le même espacement qu'entre deux tuiles.
    () => squarify(groups.map((g) => g.amount), { x: GAP / 2, y: GAP / 2, w: width - GAP, h: height - GAP }),
    [groups, width, height],
  );

  const switchType = (t: TxType) => {
    setType(t);
    setTip(null);
    if (selection && selection.type !== t) onSelect(null);
  };

  const moveTip = (id: string) => (e: MouseEvent<HTMLButtonElement>) => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (box) setTip({ id, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  // L'infobulle garde sa dernière position le temps de son animation de sortie.
  const tipShown = usePresence(tip);
  const shown = tipShown.item;
  const tipGroup = shown ? groups.find((g) => g.id === shown.id) : undefined;
  // L'infobulle reste dans la zone des carrés : elle ne peut pas rallonger la page.
  const tipLeft = shown
    ? shown.x + TIP_OFFSET + tipSize.w <= width
      ? shown.x + TIP_OFFSET
      : Math.max(0, shown.x - TIP_OFFSET - tipSize.w)
    : 0;
  const tipTop = shown ? Math.max(0, Math.min(shown.y + TIP_OFFSET, height - tipSize.h)) : 0;
  const isIncome = type === 'income';

  return (
    <section className={`card treemap treemap--${type}`}>
      <header className="card__head">
        <div>
          <h2>Répartition</h2>
          <p className="muted">
            {periodLabel}
            {total > 0 && ` · ${money(total)}`}
          </p>
        </div>
        <TypeTabs value={type} onChange={switchType} label="Type d’opérations" />
      </header>

      <div className="treemap__canvas" ref={canvasRef} onMouseLeave={() => setTip(null)}>
        {groups.length === 0 && (
          <div className="treemap__empty">
            <span aria-hidden>🧩</span>
            Aucun{isIncome ? ' revenu' : 'e dépense'} ce mois-ci.
          </div>
        )}
        {groups.map((g, i) => {
          const r = rects[i];
          const bx = inset(r.x, r.w);
          const by = inset(r.y, r.h);
          // Case de moins de 2 px : invisible et impossible à survoler, on ne l'affiche pas.
          if (!bx || !by) return null;
          const [left, w] = bx;
          const [top, h] = by;
          const cat = categoryOf(type, g.id);
          const share = g.amount / total;
          const selected = selection?.type === type && selection.id === g.id;
          const dimmed = !!selection && selection.type === type && !selected;
          // Contenu selon la place : tout / icône + nom + montant / icône + % / icône / rien.
          const size =
            w >= 104 && h >= 98 ? 'full'
            : w >= 92 && h >= 58 ? 'row'
            : w >= 56 && h >= 44 ? 'medium'
            : w >= 24 && h >= 24 ? 'small'
            : 'tiny';
          const style = {
            left,
            top,
            width: w,
            height: h,
            '--mix': `${Math.round(14 + 38 * (g.amount / max))}%`,
          } as CSSProperties;
          return (
            <button
              key={g.id}
              className={`tile tile--${size}${selected ? ' is-selected' : ''}${dimmed ? ' is-dim' : ''}`}
              style={style}
              aria-pressed={selected}
              aria-label={`${cat.label} : ${money(g.amount)}, ${pctLabel(share)} %, ${g.count} opération${plural(g.count)}`}
              onClick={() => onSelect(selected ? null : { type, id: g.id })}
              onMouseMove={moveTip(g.id)}
            >
              {size !== 'tiny' && size !== 'row' && <span className="tile__icon" aria-hidden>{cat.icon}</span>}
              {size === 'full' && (
                <>
                  <span className="tile__label">{cat.label}</span>
                  <span className="tile__amount">{money(g.amount)}</span>
                  <span className="tile__pct">{pctLabel(share)} %</span>
                </>
              )}
              {size === 'row' && (
                <>
                  <span className="tile__label">
                    <span aria-hidden>{cat.icon}</span> {cat.label}
                  </span>
                  <span className="tile__amount">
                    {money(g.amount)} · {pctLabel(share)} %
                  </span>
                </>
              )}
              {size === 'medium' && <span className="tile__pct">{pctLabel(share)} %</span>}
            </button>
          );
        })}

        {shown && tipGroup && (
          <div
            className="info-tip treemap__tip"
            ref={tipRef}
            data-state={tipShown.state}
            style={{ left: tipLeft, top: tipTop }}
            role="status"
          >
            <strong>
              {categoryOf(type, tipGroup.id).icon} {categoryOf(type, tipGroup.id).label}
            </strong>
            <div className="info-tip__row">
              <span>Montant</span>
              <b>{money(tipGroup.amount)}</b>
            </div>
            <div className="info-tip__row">
              <span>Part du mois</span>
              <b>{pctLabel(tipGroup.amount / total)} %</b>
            </div>
            <div className="info-tip__row">
              <span>Opérations</span>
              <b>{tipGroup.count}</b>
            </div>
            <small>
              {selection?.type === type && selection.id === tipGroup.id ? 'Cliquer pour tout afficher' : 'Cliquer pour filtrer les opérations'}
            </small>
          </div>
        )}
      </div>
    </section>
  );
}
