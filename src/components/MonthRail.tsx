import { useEffect } from 'react';
import { monthIndexOf, type MonthData } from '../lib/finance';
import { monthLabel, monthShortName, periodRange, signedMoney } from '../lib/format';
import { useElementWidth } from '../lib/motion';

interface Props {
  months: MonthData[];
  index: number;
  today: string;
  onSelect: (index: number) => void;
}

/** Vue d'ensemble compacte de tous les mois : un clic pour y aller. */
export function MonthRail({ months, index, today, onSelect }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const maxAbs = Math.max(1, ...months.map((m) => Math.abs(m.income - m.expense)));
  const todayIndex = monthIndexOf(months, today);

  useEffect(() => {
    const rail = ref.current;
    const item = rail?.children[index] as HTMLElement | undefined;
    if (!rail || !item) return;
    const left = item.offsetLeft - rail.clientWidth / 2 + item.offsetWidth / 2;
    rail.scrollTo({ left, behavior: 'smooth' });
    // Recentrer aussi quand la largeur change (rotation d'écran, fenêtre redimensionnée).
  }, [index, months.length, width, ref]);

  return (
    <div className="rail" ref={ref} role="tablist" aria-label="Mois">
      {months.map((m, i) => {
        const net = m.income - m.expense;
        const h = Math.max(2, (Math.abs(net) / maxAbs) * 16);
        const showYear = i === 0 || m.month === 0;
        return (
          <button
            key={m.key}
            role="tab"
            aria-selected={i === index}
            title={`${monthLabel(m.key)} (${periodRange(m.start, m.end)}) · ${signedMoney(net)}`}
            className={`rail__item${i === index ? ' is-active' : ''}${m.start > today ? ' is-future' : ''}${i === todayIndex ? ' is-current' : ''}`}
            onClick={() => onSelect(i)}
          >
            <span className="rail__bars" aria-hidden>
              <span className={`rail__bar ${net >= 0 ? 'up' : 'down'}`} style={{ height: h }} />
            </span>
            <span className="rail__name">{monthShortName(m.key)}</span>
            <span className="rail__year">{showYear ? m.year : '\u00a0'}</span>
          </button>
        );
      })}
    </div>
  );
}
