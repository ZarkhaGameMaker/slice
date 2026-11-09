import { categoryOf } from '../lib/categories';
import { nextOccurrences } from '../lib/finance';
import { dayShort, money } from '../lib/format';
import type { Account, Recurring } from '../lib/types';
import { PlusIcon, RepeatIcon } from './Icons';

interface Props {
  rules: Recurring[];
  accounts: Map<string, Account>;
  showAccount: boolean;
  today: string;
  onOpen: (rule: Recurring) => void;
  onAdd: () => void;
}

export function RecurringList({ rules, accounts, showAccount, today, onOpen, onAdd }: Props) {
  const sorted = [...rules].sort((a, b) => (a.type === b.type ? a.day - b.day : a.type === 'income' ? -1 : 1));
  const monthlyNet = rules
    .filter((r) => !r.endMonth || r.endMonth >= today.slice(0, 7))
    .reduce((s, r) => s + (r.type === 'income' ? r.amount : -r.amount), 0);

  return (
    <section className="card list-card">
      <header className="card__head">
        <div>
          <h2>Automatiques</h2>
          <p className="muted">
            {rules.length ? `Bilan mensuel : ${monthlyNet >= 0 ? '+' : '−'}${money(Math.abs(monthlyNet))}` : 'Salaire, loyer, abonnements…'}
          </p>
        </div>
        <button className="btn btn--soft btn--sm" onClick={onAdd}>
          <PlusIcon width={16} height={16} /> Ajouter
        </button>
      </header>

      {sorted.length === 0 ? (
        <div className="empty-list">
          <div className="empty-list__art" aria-hidden>🔁</div>
          <p>
            Programmez votre salaire une fois : il sera ajouté chaque mois, avancé au vendredi si le jour tombe un samedi et
            reporté au lundi si c’est un dimanche.
          </p>
          <button className="btn btn--primary btn--sm" onClick={onAdd}>
            <RepeatIcon width={16} height={16} /> Programmer un salaire
          </button>
        </div>
      ) : (
        <ul className="rules">
          {sorted.map((r) => {
            const next = nextOccurrences(r, today, 1)[0];
            const cat = categoryOf(r.type, r.category);
            const acct = accounts.get(r.accountId);
            const ended = !!r.endMonth && r.endMonth < today.slice(0, 7);
            return (
              <li key={r.id}>
                <button className={`rule${ended ? ' is-ended' : ''}`} onClick={() => onOpen(r)}>
                  <span className={`rule__day ${r.type === 'income' ? 'up' : 'down'}`}>
                    <small>le</small>
                    {r.day}
                  </span>
                  <span className="rule__text">
                    <span className="rule__label">
                      {cat.icon} {r.label}
                    </span>
                    <span className="rule__meta">
                      {ended ? 'Terminé' : next ? `Prochain : ${dayShort(next)}` : 'Aucune échéance à venir'}
                      {r.skipped.length > 0 && ` · ${r.skipped.length} mois ignoré(s)`}
                      {showAccount && acct && <span className={`badge badge--acct acct--${acct.color}`}>{acct.name}</span>}
                    </span>
                  </span>
                  <span className={`rule__amount ${r.type === 'income' ? 'up' : 'down'}`}>
                    {r.type === 'income' ? '+' : '−'}
                    {money(r.amount)}
                    <small>/ mois</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
