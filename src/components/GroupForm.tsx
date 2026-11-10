import { useMemo, useState, type FormEvent } from 'react';
import { categoryOf } from '../lib/categories';
import { daysBetween } from '../lib/dates';
import { groupNet } from '../lib/finance';
import { amountToInput, dayMonthShort, money, parseAmount, plural, signedMoney } from '../lib/format';
import { uid } from '../lib/store';
import type { Account, Transaction, TxGroup, TxType } from '../lib/types';
import { AmountInput, Field } from './Forms';
import { CheckIcon, CloseIcon, LinkIcon, PlusIcon, TrashIcon } from './Icons';
import { Modal } from './Modal';

interface Props {
  /** Opération de départ : le groupe se construit autour d'elle. */
  anchor: Transaction;
  /** Groupe existant, quand l'opération en fait déjà partie. */
  group?: TxGroup;
  /** Opérations candidates (tous comptes confondus). */
  transactions: Transaction[];
  accounts: Map<string, Account>;
  showAccount: boolean;
  onSubmit: (group: TxGroup, members: string[]) => void;
  /** Dissout le groupe existant. */
  onDissolve?: () => void;
  onClose: () => void;
}

/** Fenêtre de recherche autour de l'opération de départ, en jours. */
const WINDOW = 75;
/** Nombre de candidates affichées sans recherche. */
const SHORT_LIST = 8;

export function GroupForm({ anchor, group, transactions, accounts, showAccount, onSubmit, onDissolve, onClose }: Props) {
  const byId = useMemo(() => new Map(transactions.map((t) => [t.id, t])), [transactions]);
  const [members, setMembers] = useState<string[]>(() =>
    group ? transactions.filter((t) => t.groupId === group.id).map((t) => t.id) : [anchor.id],
  );
  const [leadId, setLeadId] = useState(group?.leadId ?? anchor.id);
  const [label, setLabel] = useState(group?.label ?? '');
  const [custom, setCustom] = useState(group?.amount !== undefined);
  const [amount, setAmount] = useState(group?.amount !== undefined ? amountToInput(group.amount) : '');
  const [type, setType] = useState<TxType>(group?.type ?? anchor.type);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const chosen = members.map((id) => byId.get(id)).filter((t): t is Transaction => !!t);
  const net = groupNet(chosen);
  // Les deux côtés du groupe, pour le récapitulatif (« X dépensés · Y reçus »).
  const sorties = chosen.filter((t) => t.type === 'expense');
  const entrees = chosen.filter((t) => t.type === 'income');
  const totalDe = (list: Transaction[]) => list.reduce((s, t) => s + t.amount, 0);
  const lead = byId.get(leadId) ?? chosen[0];
  const finalType = custom ? type : net.type;
  const finalAmount = custom ? parseAmount(amount) : net.amount;
  const category = lead ? categoryOf(finalType, lead.category) : null;

  // Candidates : proches dans le temps, libres de tout autre groupe, hors membres déjà choisis.
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = transactions.filter(
      (t) =>
        !members.includes(t.id) &&
        (!t.groupId || t.groupId === group?.id) &&
        Math.abs(daysBetween(anchor.date, t.date)) <= WINDOW &&
        (!q || t.label.toLowerCase().includes(q) || categoryOf(t.type, t.category).label.toLowerCase().includes(q)),
    );
    list.sort((a, b) => Math.abs(daysBetween(anchor.date, a.date)) - Math.abs(daysBetween(anchor.date, b.date)));
    return list;
  }, [transactions, members, group?.id, anchor.date, search]);

  const add = (id: string) => {
    setMembers((m) => [...m, id]);
    setError('');
  };
  const remove = (id: string) => {
    setMembers((m) => {
      const next = m.filter((x) => x !== id);
      if (id === leadId && next[0]) setLeadId(next[0]);
      return next;
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (members.length < 2) return setError('Un groupe réunit au moins deux opérations.');
    if (custom && !(finalAmount >= 0)) return setError('Indiquez un montant retenu valide.');
    onSubmit(
      {
        id: group?.id ?? uid(),
        label: label.trim() || lead?.label || 'Groupe',
        leadId: members.includes(leadId) ? leadId : members[0],
        ...(custom ? { amount: finalAmount, type } : {}),
      },
      members,
    );
    onClose();
  };

  const row = (t: Transaction, inside: boolean) => {
    const cat = categoryOf(t.type, t.category);
    const acct = accounts.get(t.accountId);
    const isLead = inside && t.id === leadId;
    return (
      <li key={t.id} className={`grp-row${isLead ? ' is-lead' : ''}`}>
        {inside ? (
          <button
            type="button"
            className={`grp-row__lead${isLead ? ' is-on' : ''}`}
            role="radio"
            aria-checked={isLead}
            title={isLead ? 'Opération principale du groupe' : 'En faire l’opération principale'}
            onClick={() => setLeadId(t.id)}
          >
            {isLead ? <CheckIcon width={13} height={13} /> : <span className="grp-row__dot" aria-hidden />}
          </button>
        ) : (
          <span className="grp-row__icon" aria-hidden>{cat.icon}</span>
        )}
        <span className="grp-row__text">
          <span className="grp-row__label">{t.label}</span>
          <span className="grp-row__meta">
            {dayMonthShort(t.date)} · {cat.label}
            {isLead && <span className="badge badge--group">Principale</span>}
            {inside && !isLead && <span className="badge">Secondaire</span>}
            {showAccount && acct && <span className={`badge badge--acct acct--${acct.color}`}>{acct.name}</span>}
          </span>
        </span>
        <span className={`grp-row__amount ${t.type === 'income' ? 'up' : 'down'}`}>
          {signedMoney(t.type === 'income' ? t.amount : -t.amount)}
        </span>
        <button
          type="button"
          className="grp-row__action"
          title={inside ? 'Retirer du groupe' : 'Ajouter au groupe'}
          aria-label={`${inside ? 'Retirer' : 'Ajouter'} « ${t.label} »`}
          onClick={() => (inside ? remove(t.id) : add(t.id))}
        >
          {inside ? <CloseIcon width={15} height={15} /> : <PlusIcon width={15} height={15} />}
        </button>
      </li>
    );
  };

  return (
    <Modal
      title={group ? 'Modifier le groupe' : 'Regrouper des opérations'}
      subtitle="Les montants restent dans le solde ; seul le montant retenu compte dans les catégories."
      onClose={onClose}
      footer={
        <>
          {onDissolve && (
            <button type="button" className="btn btn--ghost-danger" onClick={onDissolve}>
              <TrashIcon width={16} height={16} /> Dissoudre
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
          <button type="submit" form="modal-form" className="btn btn--primary">
            {group ? 'Enregistrer' : 'Regrouper'}
          </button>
        </>
      }
    >
      <form id="modal-form" className="form" onSubmit={submit}>
        <div className={`grp-sum grp-sum--${finalType}`}>
          <span className="grp-sum__icon" aria-hidden>{category?.icon ?? '🔗'}</span>
          <span className="grp-sum__text">
            <strong>
              {signedMoney(finalType === 'income' ? finalAmount : -finalAmount)} en « {category?.label ?? '—'} »
            </strong>
            <small>
              {members.length} opération{plural(members.length)} ·{' '}
              {sorties.length > 0 && `${money(totalDe(sorties))} dépensés`}
              {sorties.length > 0 && entrees.length > 0 && ' · '}
              {entrees.length > 0 && `${money(totalDe(entrees))} reçus`}
            </small>
          </span>
        </div>

        <Field label="Opérations du groupe" hint="La principale donne sa catégorie et sa date au montant retenu.">
          <ul className="grp-list">{chosen.map((t) => row(t, true))}</ul>
        </Field>
        {error && <p className="form__error">{error}</p>}

        <Field label="Nom du groupe">
          <input
            className="input"
            value={label}
            placeholder={lead?.label ?? 'Groupe'}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>

        <label className="toggle-row">
          <span className="toggle-row__text">
            <strong>Choisir moi-même le montant retenu</strong>
            <small>
              Par défaut, c’est le net du groupe : {signedMoney(net.type === 'income' ? net.amount : -net.amount)}.
            </small>
          </span>
          <span className="switch">
            <input type="checkbox" checked={custom} onChange={(e) => { setCustom(e.target.checked); setError(''); }} />
            <span />
          </span>
        </label>
        {custom && (
          <>
            <div className="chips" role="radiogroup" aria-label="Sens du montant retenu">
              <button type="button" role="radio" aria-checked={type === 'expense'} className={`chip${type === 'expense' ? ' is-active' : ''}`} onClick={() => setType('expense')}>
                Dépense
              </button>
              <button type="button" role="radio" aria-checked={type === 'income'} className={`chip${type === 'income' ? ' is-active' : ''}`} onClick={() => setType('income')}>
                Revenu
              </button>
            </div>
            <AmountInput value={amount} onChange={(v) => { setAmount(v); setError(''); }} type={type} />
          </>
        )}

        <Field label="Ajouter une opération">
          <input
            className="input"
            placeholder="Rechercher par libellé ou catégorie…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        {candidates.length === 0 ? (
          <p className="field__hint">Aucune opération libre à moins de {WINDOW} jours de celle-ci.</p>
        ) : (
          <ul className="grp-list grp-list--pick">
            {candidates.slice(0, search.trim() ? 30 : SHORT_LIST).map((t) => row(t, false))}
          </ul>
        )}

        <p className="field__hint">
          <LinkIcon width={12} height={12} /> Les opérations secondaires restent visibles et comptent dans le solde :
          elles sortent seulement des catégories, des bilans, des moyennes et de la prévision.
        </p>
      </form>
    </Modal>
  );
}
