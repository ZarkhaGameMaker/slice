import { useState } from 'react';
import { categoryOf } from '../lib/categories';
import type { Account, Entry, TxGroup } from '../lib/types';
import { dayLabel, signedMoney } from '../lib/format';
import type { CategorySelection } from './CategoryTreemap';
import { CloseIcon, LinkIcon, MinusIcon, PlusIcon, RepeatIcon, SkipIcon, SparkIcon, TrashIcon, UploadIcon } from './Icons';

type Filter = 'all' | 'income' | 'expense';

interface Props {
  /** Nom de la période affichée, ex. « Septembre 2026 · 4 sept. → 4 oct. ». */
  periodLabel: string;
  entries: Entry[];
  accounts: Map<string, Account>;
  showAccount: boolean;
  today: string;
  onOpen: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
  onSkip: (entry: Entry) => void;
  /** Marque (ou démarque) l'opération comme exceptionnelle : hors bilan, moyennes et prévision. */
  onToggleExceptional: (entry: Entry) => void;
  /** Groupes d'opérations, par identifiant. */
  groups: Map<string, TxGroup>;
  /** Ouvre la fenêtre de regroupement, sur un groupe existant ou pour en créer un. */
  onGroup: (entry: Entry) => void;
  onAdd: (type: 'income' | 'expense') => void;
  /** Catégorie choisie dans la répartition : remplace le filtre Tout / Revenus / Dépenses. */
  category: CategorySelection | null;
  onClearCategory: () => void;
  /** Ouvre l'import d'un relevé bancaire CSV. */
  onImport: () => void;
}

export function TransactionList({
  periodLabel,
  entries,
  accounts,
  showAccount,
  today,
  onOpen,
  onDelete,
  onSkip,
  onToggleExceptional,
  groups,
  onGroup,
  onAdd,
  category,
  onClearCategory,
  onImport,
}: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const visible = category
    ? entries.filter((e) => e.type === category.type && e.category === category.id)
    : entries.filter((e) => filter === 'all' || e.type === filter);
  const selectedCat = category && categoryOf(category.type, category.id);

  // Opérations du jour, regroupées par date (à ne pas confondre avec les groupes d’opérations).
  const days = new Map<string, Entry[]>();
  for (const e of [...visible].sort((a, b) => (a.date === b.date ? a.label.localeCompare(b.label) : a.date < b.date ? 1 : -1))) {
    const g = days.get(e.date);
    if (g) g.push(e);
    else days.set(e.date, [e]);
  }

  return (
    <section className="card list-card">
      <header className="card__head">
        <div>
          <h2>Opérations</h2>
          <p className="muted">{periodLabel}</p>
        </div>
        <div className="card__head-actions">
          <button className="icon-btn icon-btn--sm" onClick={onImport} title="Importer un relevé bancaire (CSV)" aria-label="Importer un relevé bancaire (CSV)">
            <UploadIcon width={16} height={16} />
          </button>
          {category && selectedCat ? (
            <button className={`filter-chip filter-chip--${category.type}`} onClick={onClearCategory} aria-label={`Retirer le filtre ${selectedCat.label}`}>
              <span aria-hidden>{selectedCat.icon}</span> {selectedCat.label}
              <CloseIcon width={14} height={14} />
            </button>
          ) : (
            <div className="segmented segmented--sm" role="tablist">
              {(['all', 'income', 'expense'] as Filter[]).map((f) => (
                <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'is-active' : ''} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'Tout' : f === 'income' ? 'Revenus' : 'Dépenses'}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {days.size === 0 ? (
        <div className="empty-list">
          <div className="empty-list__art" aria-hidden>🧾</div>
          <p>
            {selectedCat
              ? `Aucune opération « ${selectedCat.label} » ce mois-ci.`
              : `Aucune opération ${filter === 'income' ? 'de revenu ' : filter === 'expense' ? 'de dépense ' : ''}ce mois-ci.`}
          </p>
          <div className="row-gap">
            <button className="btn btn--soft-up btn--sm" onClick={() => onAdd('income')}><PlusIcon width={16} height={16} /> Revenu</button>
            <button className="btn btn--soft-down btn--sm" onClick={() => onAdd('expense')}><MinusIcon width={16} height={16} /> Dépense</button>
          </div>
        </div>
      ) : (
        <div className="tx-groups">
          {[...days.entries()].map(([date, list]) => {
            const dayNet = list.reduce((s, e) => s + (e.type === 'income' ? e.amount : -e.amount), 0);
            return (
              <div key={date} className={`tx-group${date > today ? ' is-future' : ''}`}>
                <div className="tx-group__head">
                  <span>{date === today ? 'Aujourd’hui' : dayLabel(date)}</span>
                  <span className={`tx-group__total ${dayNet >= 0 ? 'up' : 'down'}`}>
                    <small>Total</small> {signedMoney(dayNet)}
                  </span>
                </div>
                <ul>
                  {list.map((e) => {
                    const cat = categoryOf(e.type, e.category);
                    const acct = accounts.get(e.accountId);
                    const group = e.groupId ? groups.get(e.groupId) : undefined;
                    const second = !!group && group.leadId !== e.id;
                    return (
                      <li key={e.id} className={`tx${e.exceptional ? ' is-odd' : ''}`}>
                        <button className="tx__main" onClick={() => onOpen(e)}>
                          <span className={`tx__icon ${e.type === 'income' ? 'tx__icon--up' : 'tx__icon--down'}`}>{cat.icon}</span>
                          <span className="tx__text">
                            <span className="tx__label">{e.label}</span>
                            <span className="tx__meta">
                              {cat.label}
                              {e.recurringId && (
                                <span className="badge badge--auto"><RepeatIcon width={11} height={11} /> Auto</span>
                              )}
                              {group && (
                                <span
                                  className={`badge badge--group${second ? ' is-second' : ''}`}
                                  title={
                                    second
                                      ? `Secondaire dans « ${group.label} » : son montant ne compte pas dans sa catégorie`
                                      : `Opération principale de « ${group.label} » : elle porte le montant retenu du groupe`
                                  }
                                >
                                  <LinkIcon width={11} height={11} /> {second ? 'Secondaire' : group.label}
                                </span>
                              )}
                              {e.exceptional && (
                                <span className="badge badge--odd"><SparkIcon width={11} height={11} /> Exceptionnel</span>
                              )}
                              {date > today && <span className="badge">Prévu</span>}
                              {showAccount && acct && (
                                <span className={`badge badge--acct acct--${acct.color}`}>{acct.name}</span>
                              )}
                            </span>
                          </span>
                          <span className={`tx__amount ${e.type === 'income' ? 'up' : 'down'}`}>
                            {signedMoney(e.type === 'income' ? e.amount : -e.amount)}
                          </span>
                        </button>
                        {e.recurringId ? (
                          <button className="tx__action" title="Ignorer ce mois-ci" aria-label={`Ignorer ${e.label} ce mois-ci`} onClick={() => onSkip(e)}>
                            <SkipIcon width={16} height={16} />
                          </button>
                        ) : (
                          <>
                            <button
                              className={`tx__action tx__action--link${group ? ' is-on' : ''}`}
                              aria-pressed={!!group}
                              title={group ? `Modifier le groupe « ${group.label} »` : 'Regrouper avec d’autres opérations (remboursement…)'}
                              aria-label={`${group ? 'Modifier le groupe de' : 'Regrouper'} « ${e.label} »`}
                              onClick={() => onGroup(e)}
                            >
                              <LinkIcon width={16} height={16} />
                            </button>
                            <button
                              className={`tx__action tx__action--odd${e.exceptional ? ' is-on' : ''}`}
                              aria-pressed={!!e.exceptional}
                              title={
                                e.exceptional
                                  ? 'Redevient une opération ordinaire'
                                  : 'Marquer exceptionnelle : hors bilan, moyennes et prévision'
                              }
                              aria-label={`${e.exceptional ? 'Ne plus traiter' : 'Traiter'} « ${e.label} » comme une opération exceptionnelle`}
                              onClick={() => onToggleExceptional(e)}
                            >
                              <SparkIcon width={16} height={16} />
                            </button>
                            <button className="tx__action" title="Supprimer" aria-label={`Supprimer ${e.label}`} onClick={() => onDelete(e)}>
                              <TrashIcon width={16} height={16} />
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
