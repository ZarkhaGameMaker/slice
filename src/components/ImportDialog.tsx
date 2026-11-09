import { useMemo, useState } from 'react';
import {
  analyzeImport,
  buildImport,
  checkedByDefault,
  extractRows,
  selectable,
  suggestTargets,
  type AnalyzedRow,
  type RowStatus,
} from '../lib/bankImport';
import { categoriesFor } from '../lib/categories';
import { hasEssentialColumns, type ColumnMap, type ColumnRole, type CsvTable } from '../lib/csv';
import { signedMoney } from '../lib/format';
import { uid } from '../lib/store';
import type { Account, Recurring, Transaction } from '../lib/types';
import { Modal } from './Modal';

export interface ImportResult {
  transactions: Transaction[];
  skips: { id: string; month: string }[];
  /** Lignes reconnues comme déjà importées (jamais ajoutées). */
  alreadyImported: number;
  /** Numéros de compte du relevé et compte qui les a reçus. */
  links: { accountId: string; bankRef: string }[];
}

interface Props {
  fileName: string;
  table: CsvTable;
  accounts: Account[];
  transactions: Transaction[];
  recurrings: Recurring[];
  defaultAccountId: string;
  onImport: (result: ImportResult) => void;
  onClose: () => void;
}

const ROLES: [ColumnRole, string][] = [
  ['date', 'Date'],
  ['label', 'Libellé'],
  ['amount', 'Montant'],
  ['debit', 'Débit'],
  ['credit', 'Crédit'],
  ['category', 'Catégorie banque'],
  ['account', 'N° de compte'],
];

const STATUS_LABEL: Record<RowStatus, string> = {
  new: 'Nouvelle',
  imported: 'Déjà importée',
  recurring: 'Remplace l’automatique',
  duplicate: 'Doublon probable',
  ignored: 'Compte non importé',
  error: 'Illisible',
};

/** Au-delà, l'aperçu n'affiche que les premières lignes (l'import, lui, porte sur tout). */
const PREVIEW_LIMIT = 400;

type Filter = 'all' | 'kept' | 'dropped';

export function ImportDialog({ fileName, table, accounts, transactions, recurrings, defaultAccountId, onImport, onClose }: Props) {
  const [columns, setColumns] = useState<ColumnMap>(table.columns);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<number, { checked?: boolean; category?: string }>>({});
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => extractRows(table, columns), [table, columns]);

  // Comptes présents dans le fichier (un seul, sans nom, pour la plupart des banques).
  const bankAccounts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!r.error && !seen.has(r.bankAccount)) seen.set(r.bankAccount, r.bankAccountName);
    return [...seen].map(([key, name]) => ({ key, name }));
  }, [rows]);

  // Compte de destination : choix de l'utilisateur, sinon la meilleure suggestion (compte déjà lié…).
  const suggested = useMemo(
    () => suggestTargets(rows, accounts, transactions, defaultAccountId),
    [rows, accounts, transactions, defaultAccountId],
  );
  const effectiveTargets = useMemo(() => ({ ...suggested, ...targets }), [suggested, targets]);
  const accountName = (id?: string) => accounts.find((a) => a.id === id)?.name ?? 'un autre compte';

  const analyzed = useMemo(
    () => analyzeImport(rows, effectiveTargets, { transactions, recurrings }),
    [rows, effectiveTargets, transactions, recurrings],
  );

  const isChecked = (r: AnalyzedRow) => selectable(r) && (overrides[r.line]?.checked ?? checkedByDefault(r));
  const categoryFor = (r: AnalyzedRow) => overrides[r.line]?.category ?? r.category;
  const setOverride = (line: number, patch: { checked?: boolean; category?: string }) =>
    setOverrides((o) => ({ ...o, [line]: { ...o[line], ...patch } }));

  const count = (status: RowStatus) => analyzed.filter((r) => r.status === status).length;
  const chosen = analyzed.filter(isChecked);
  const visible = analyzed.filter((r) => (filter === 'all' ? true : filter === 'kept' ? isChecked(r) : !isChecked(r)));
  const shown = visible.slice(0, PREVIEW_LIMIT);
  const togglable = shown.filter(selectable);
  const allOn = togglable.length > 0 && togglable.every(isChecked);
  const columnsOk = hasEssentialColumns(columns);

  const confirm = () => {
    const { transactions: txs, skips } = buildImport(chosen, uid, categoryFor);
    const links = bankAccounts
      .filter(({ key }) => key && effectiveTargets[key])
      .map(({ key }) => ({ accountId: effectiveTargets[key], bankRef: key }));
    onImport({ transactions: txs, skips, alreadyImported: count('imported'), links });
    onClose();
  };

  const formatDate = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

  return (
    <Modal
      title="Importer des opérations"
      subtitle={`${fileName} · ${table.rows.length} ligne${table.rows.length > 1 ? 's' : ''}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <span className="import__foot-note">
            {chosen.length === 0
              ? 'Aucune opération sélectionnée'
              : `${chosen.length} opération${chosen.length > 1 ? 's' : ''} seront ajoutées`}
          </span>
          <span className="spacer" />
          <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn--primary" onClick={confirm} disabled={chosen.length === 0}>
            {chosen.length ? `Importer ${chosen.length} opération${chosen.length > 1 ? 's' : ''}` : 'Rien à importer'}
          </button>
        </>
      }
    >
      <div className="import">
        <div className="import__intro">
          <span className={`badge${table.format === 'boursobank' ? ' badge--auto' : ''}`}>
            {table.format === 'boursobank' ? 'Format BoursoBank reconnu' : 'Relevé CSV'}
          </span>
          <span className="muted">
            Les lignes déjà importées sont reconnues et ne seront jamais ajoutées deux fois.
          </span>
        </div>

        <div className="import__targets">
          {bankAccounts.length <= 1 ? (
            <label className="import__target">
              <span>Importer dans</span>
              <select
                className="input"
                value={effectiveTargets[bankAccounts[0]?.key ?? ''] ?? defaultAccountId}
                onChange={(e) => setTargets({ ...targets, [bankAccounts[0]?.key ?? '']: e.target.value })}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              {bankAccounts[0]?.name && <small className="muted">Compte du fichier : {bankAccounts[0].name}</small>}
            </label>
          ) : (
            bankAccounts.map(({ key, name }) => (
              <label key={key} className="import__target">
                <span>{name || 'Compte sans nom'}</span>
                <select className="input" value={effectiveTargets[key]} onChange={(e) => setTargets({ ...targets, [key]: e.target.value })}>
                  <option value="">Ne pas importer</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
            ))
          )}
        </div>

        <details className="import__columns" open={!columnsOk}>
          <summary>
            Colonnes du fichier {columnsOk ? <span className="muted">· reconnues automatiquement</span> : <span className="down">· à préciser</span>}
          </summary>
          <div className="import__columns-grid">
            {ROLES.map(([role, label]) => (
              <label key={role} className="field">
                <span className="field__label">{label}</span>
                <select
                  className="input"
                  value={columns[role]}
                  onChange={(e) => {
                    setColumns({ ...columns, [role]: Number(e.target.value) });
                    setOverrides({});
                  }}
                >
                  <option value={-1}>—</option>
                  {table.headers.map((h, i) => (
                    <option key={i} value={i}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>

        <div className="import__summary">
          <span className="import__chip is-new">{chosen.length} à importer</span>
          {count('imported') > 0 && <span className="import__chip is-imported">{count('imported')} déjà importée{count('imported') > 1 ? 's' : ''}</span>}
          {count('recurring') > 0 && <span className="import__chip is-recurring">{count('recurring')} remplace{count('recurring') > 1 ? 'nt' : ''} une automatique</span>}
          {count('duplicate') > 0 && <span className="import__chip is-duplicate">{count('duplicate')} doublon{count('duplicate') > 1 ? 's' : ''} probable{count('duplicate') > 1 ? 's' : ''}</span>}
          {count('ignored') > 0 && <span className="import__chip">{count('ignored')} d’un compte non importé</span>}
          {count('error') > 0 && <span className="import__chip is-error">{count('error')} illisible{count('error') > 1 ? 's' : ''}</span>}
          <span className="spacer" />
          <div className="segmented segmented--sm" role="tablist">
            {(['all', 'kept', 'dropped'] as Filter[]).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'is-active' : ''} onClick={() => setFilter(f)}>
                {f === 'all' ? 'Toutes' : f === 'kept' ? 'À importer' : 'Écartées'}
              </button>
            ))}
          </div>
        </div>

        <div className="import__table-wrap">
          <table className="import__table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Tout sélectionner"
                    checked={allOn}
                    disabled={togglable.length === 0}
                    onChange={(e) => {
                      const next = { ...overrides };
                      for (const r of togglable) next[r.line] = { ...next[r.line], checked: e.target.checked };
                      setOverrides(next);
                    }}
                  />
                </th>
                <th>Date</th>
                <th>Libellé</th>
                <th>Catégorie</th>
                <th className="num">Montant</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const checked = isChecked(r);
                return (
                  <tr key={r.line} className={`import-row is-${r.status}${checked ? ' is-checked' : ''}`}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Importer ${r.label}`}
                        checked={checked}
                        disabled={!selectable(r)}
                        onChange={(e) => setOverride(r.line, { checked: e.target.checked })}
                      />
                    </td>
                    <td className="import-row__date">{formatDate(r.date)}</td>
                    <td className="import-row__label">
                      <strong>{r.label || '—'}</strong>
                      {r.rawLabel && r.rawLabel !== r.label && <small title={r.rawLabel}>{r.rawLabel}</small>}
                    </td>
                    <td>
                      <select
                        className="input input--sm"
                        value={categoryFor(r)}
                        disabled={!selectable(r)}
                        onChange={(e) => setOverride(r.line, { category: e.target.value })}
                        aria-label="Catégorie"
                      >
                        {categoriesFor(r.type).map((c) => (
                          <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className={`num import-row__amount ${r.amount >= 0 ? 'up' : 'down'}`}>{r.error ? '—' : signedMoney(r.amount)}</td>
                    <td>
                      <span className={`import-status is-${r.status}`}>
                        {r.status === 'recurring' ? `Remplace « ${r.match} »` : r.status === 'error' ? r.error : STATUS_LABEL[r.status]}
                      </span>
                      {r.status === 'duplicate' && (
                        <small className="import-row__match">
                          {r.elsewhere ? `Déjà dans « ${accountName(r.elsewhere)} »` : `Comme : ${r.match}`}
                        </small>
                      )}
                      {r.status === 'imported' && r.match && <small className="import-row__match">{r.match}</small>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visible.length === 0 && <p className="import__empty">Aucune ligne dans cette vue.</p>}
          {visible.length > PREVIEW_LIMIT && (
            <p className="import__empty">
              Aperçu limité aux {PREVIEW_LIMIT} premières lignes sur {visible.length} — l’import porte sur toutes les lignes cochées.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
