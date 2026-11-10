import type { TxType } from '../lib/types';

interface Props {
  value: TxType;
  onChange: (type: TxType) => void;
  /** Libellé lu par les lecteurs d'écran : « Type d'opérations », « Type de catégorie »… */
  label: string;
  /** Dans un <form>, les boutons doivent être déclarés « button » pour ne pas le soumettre. */
  inForm?: boolean;
}

/** Bascule Dépenses / Revenus, partagée par la répartition, les moyennes et les catégories. */
export function TypeTabs({ value, onChange, label, inForm }: Props) {
  const isIncome = value === 'income';
  const type = inForm ? ({ type: 'button' } as const) : undefined;
  return (
    <div className="segmented segmented--sm" role="tablist" aria-label={label}>
      <button {...type} role="tab" aria-selected={!isIncome} className={!isIncome ? 'is-active' : ''} onClick={() => onChange('expense')}>
        Dépenses
      </button>
      <button {...type} role="tab" aria-selected={isIncome} className={isIncome ? 'is-active' : ''} onClick={() => onChange('income')}>
        Revenus
      </button>
    </div>
  );
}
