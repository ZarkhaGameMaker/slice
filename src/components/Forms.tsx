import { useState, type FormEvent, type ReactNode } from 'react';
import { ACCOUNT_COLORS, categoriesFor, categoryOf } from '../lib/categories';
import { NewCategory } from './CategoryForm';
import { addMonths, daysBetween, daysInMonth, isoOf, monthKeyOf, parseISO, parseMonthKey, toISO } from '../lib/dates';
import { periodDay, periodKeyOf, periodStartDate, recurringDate } from '../lib/finance';
import { amountToInput, dayFullLabel, dayShort, money, monthLabel, parseAmount, plural } from '../lib/format';
import { uid } from '../lib/store';
import type { Account, CustomCategory, Entry, PeriodSetting, Recurring, Transaction, TxType } from '../lib/types';
import { MinusIcon, PlusIcon, RepeatIcon, SkipIcon, TrashIcon, UndoIcon } from './Icons';
import { Modal } from './Modal';

/* ---------- Champs partagés ---------- */

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

function TypeSwitch({ value, onChange }: { value: TxType; onChange: (t: TxType) => void }) {
  return (
    <div className="type-switch" role="radiogroup" aria-label="Type d’opération">
      <button type="button" role="radio" aria-checked={value === 'income'} className={value === 'income' ? 'is-up' : ''} onClick={() => onChange('income')}>
        <PlusIcon width={16} height={16} /> Revenu
      </button>
      <button type="button" role="radio" aria-checked={value === 'expense'} className={value === 'expense' ? 'is-down' : ''} onClick={() => onChange('expense')}>
        <MinusIcon width={16} height={16} /> Dépense
      </button>
    </div>
  );
}

export function AmountInput({ value, onChange, type, error }: { value: string; onChange: (v: string) => void; type: TxType; error?: boolean }) {
  return (
    <div className={`amount-input amount-input--${type}${error ? ' has-error' : ''}`}>
      <span className="amount-input__sign">{type === 'income' ? '+' : '−'}</span>
      <input
        data-autofocus
        inputMode="decimal"
        placeholder="0,00"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,\s]/g, ''))}
        aria-label="Montant"
      />
      <span className="amount-input__cur">€</span>
    </div>
  );
}

interface PickerProps {
  type: TxType;
  value: string;
  onChange: (id: string) => void;
  /** Création d'une catégorie depuis le formulaire : elle est aussitôt sélectionnée. */
  onCreate: (category: CustomCategory) => void;
}

function CategoryPicker({ type, value, onChange, onCreate }: PickerProps) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <div className="chips" role="radiogroup" aria-label="Catégorie">
        {categoriesFor(type).map((c) => (
          <button
            type="button"
            key={c.id}
            role="radio"
            aria-checked={value === c.id}
            className={`chip${value === c.id ? ' is-active' : ''}`}
            onClick={() => onChange(c.id)}
          >
            <span aria-hidden>{c.icon}</span> {c.label}
          </button>
        ))}
        {!adding && (
          <button type="button" className="chip chip--add" onClick={() => setAdding(true)}>
            <PlusIcon width={14} height={14} /> Nouvelle
          </button>
        )}
      </div>
      {adding && (
        <NewCategory
          type={type}
          onCancel={() => setAdding(false)}
          onCreate={(c) => {
            onCreate(c);
            onChange(c.id);
            setAdding(false);
          }}
        />
      )}
    </>
  );
}

function AccountPicker({ accounts, value, onChange }: { accounts: Account[]; value: string; onChange: (id: string) => void }) {
  if (accounts.length < 2) return null;
  return (
    <Field label="Compte">
      <div className="chips" role="radiogroup" aria-label="Compte">
        {accounts.map((a) => (
          <button
            type="button"
            key={a.id}
            role="radio"
            aria-checked={value === a.id}
            className={`chip chip--acct acct--${a.color}${value === a.id ? ' is-active' : ''}`}
            onClick={() => onChange(a.id)}
          >
            <span className="chip__dot" /> {a.name}
          </button>
        ))}
      </div>
    </Field>
  );
}

function FormFooter({ onClose, onDelete, submitLabel, tone }: { onClose: () => void; onDelete?: () => void; submitLabel: string; tone: 'up' | 'down' | 'brand' }) {
  return (
    <>
      {onDelete && (
        <button type="button" className="btn btn--ghost-danger" onClick={onDelete}>
          <TrashIcon width={16} height={16} /> Supprimer
        </button>
      )}
      <span className="spacer" />
      <button type="button" className="btn btn--ghost" onClick={onClose}>Annuler</button>
      <button type="submit" form="modal-form" className={`btn ${tone === 'up' ? 'btn--up' : tone === 'down' ? 'btn--down' : 'btn--primary'}`}>
        {submitLabel}
      </button>
    </>
  );
}

/* ---------- Opération ponctuelle ---------- */

interface TxFormProps {
  initial?: Transaction;
  defaults: { type: TxType; date: string; accountId: string };
  accounts: Account[];
  onSubmit: (tx: Transaction) => void;
  onCreateCategory: (category: CustomCategory) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function TransactionForm({ initial, defaults, accounts, onSubmit, onCreateCategory, onDelete, onClose }: TxFormProps) {
  const [type, setType] = useState<TxType>(initial?.type ?? defaults.type);
  const [amount, setAmount] = useState(initial ? amountToInput(initial.amount) : '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [category, setCategory] = useState(initial?.category ?? (defaults.type === 'income' ? 'salaire' : 'courses'));
  const [date, setDate] = useState(initial?.date ?? defaults.date);
  const [accountId, setAccountId] = useState(initial?.accountId ?? defaults.accountId);
  const [exceptional, setExceptional] = useState(!!initial?.exceptional);
  const [error, setError] = useState('');

  const changeType = (t: TxType) => {
    setType(t);
    if (!categoriesFor(t).some((c) => c.id === category)) setCategory(t === 'income' ? 'salaire' : 'courses');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = parseAmount(amount);
    if (!(value > 0)) return setError('Indiquez un montant supérieur à 0.');
    if (!date) return setError('Choisissez une date.');
    onSubmit({
      // On repart de l'opération existante : son empreinte d'import ne doit pas être perdue.
      ...initial,
      id: initial?.id ?? uid(),
      accountId,
      type,
      amount: value,
      date,
      label: label.trim() || categoryOf(type, category).label,
      category,
      exceptional: exceptional || undefined,
    });
    onClose();
  };

  const title = initial
    ? 'Modifier l’opération'
    : type === 'income' ? 'Nouveau revenu' : 'Nouvelle dépense';

  return (
    <Modal
      title={title}
      subtitle={date ? dayFullLabel(date) : undefined}
      onClose={onClose}
      accent={type}
      footer={<FormFooter onClose={onClose} onDelete={onDelete} submitLabel={initial ? 'Enregistrer' : 'Ajouter'} tone={type === 'income' ? 'up' : 'down'} />}
    >
      <form id="modal-form" className="form" onSubmit={submit}>
        <TypeSwitch value={type} onChange={changeType} />
        <AmountInput value={amount} onChange={(v) => { setAmount(v); setError(''); }} type={type} error={!!error && !(parseAmount(amount) > 0)} />
        {error && <p className="form__error">{error}</p>}
        <div className="form__row">
          <Field label="Libellé">
            <input className="input" value={label} placeholder={categoryOf(type, category).label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
          </Field>
          <Field label="Date">
            <input className="input" type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Catégorie">
          <CategoryPicker type={type} value={category} onChange={setCategory} onCreate={onCreateCategory} />
        </Field>
        <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} />
        <label className="toggle-row">
          <span className="toggle-row__text">
            <strong>Opération exceptionnelle</strong>
            <small>
              Cadeau reçu, remboursement, achat unique… Elle reste comptée dans le solde, mais sort du
              bilan du mois, du taux d’épargne, des moyennes par mois et de la prévision.
            </small>
          </span>
          <span className="switch">
            <input type="checkbox" checked={exceptional} onChange={(e) => setExceptional(e.target.checked)} />
            <span />
          </span>
        </label>
      </form>
    </Modal>
  );
}

/* ---------- Opération automatique mensuelle ---------- */

interface RecFormProps {
  initial?: Recurring;
  defaults: { type: TxType; accountId: string };
  accounts: Account[];
  today: string;
  onSubmit: (r: Recurring) => void;
  onCreateCategory: (category: CustomCategory) => void;
  onDelete?: () => void;
  onClose: () => void;
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Premier mois dont l'échéance n'est pas encore passée. */
function defaultStartMonth(day: number, today: string) {
  const key = monthKeyOf(today);
  const { year, month } = parseMonthKey(key);
  return recurringDate(year, month, day) >= today ? key : addMonths(key, 1);
}

export function RecurringForm({ initial, defaults, accounts, today, onSubmit, onCreateCategory, onDelete, onClose }: RecFormProps) {
  const [type, setType] = useState<TxType>(initial?.type ?? defaults.type);
  const [amount, setAmount] = useState(initial ? amountToInput(initial.amount) : '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [category, setCategory] = useState(initial?.category ?? (defaults.type === 'income' ? 'salaire' : 'loyer'));
  const [day, setDay] = useState(initial?.day ?? 5);
  const [startMonth, setStartMonth] = useState(initial?.startMonth ?? defaultStartMonth(5, today));
  const [startTouched, setStartTouched] = useState(!!initial);
  const [hasEnd, setHasEnd] = useState(!!initial?.endMonth);
  const [endMonth, setEndMonth] = useState(initial?.endMonth ?? addMonths(monthKeyOf(today), 12));
  const [skipped, setSkipped] = useState<string[]>(initial?.skipped ?? []);
  const [accountId, setAccountId] = useState(initial?.accountId ?? defaults.accountId);
  const [error, setError] = useState('');

  const changeType = (t: TxType) => {
    setType(t);
    if (!categoriesFor(t).some((c) => c.id === category)) setCategory(t === 'income' ? 'salaire' : 'loyer');
  };

  const changeDay = (d: number) => {
    setDay(d);
    if (!startTouched) setStartMonth(defaultStartMonth(d, today));
  };

  // Aperçu : 4 échéances à partir du premier mois, avec l'explication des décalages.
  const preview: { date: string; note: string | null; past: boolean }[] = [];
  let key = startMonth || monthKeyOf(today);
  for (let guard = 0; preview.length < 4 && guard < 48; guard++, key = addMonths(key, 1)) {
    if (hasEnd && endMonth && key > endMonth) break;
    if (skipped.includes(key)) continue;
    const { year, month } = parseMonthKey(key);
    const date = recurringDate(year, month, day);
    const wanted = Math.min(day, daysInMonth(year, month));
    const got = parseISO(date).getDate();
    let note: string | null = null;
    if (wanted !== day) note = `le ${day} n’existe pas`;
    if (got !== wanted) {
      const wd = WEEKDAYS[new Date(year, month, wanted).getDay()];
      note = `${got < wanted ? 'avancé' : 'reporté'} : le ${wanted} est un ${wd}`;
    }
    preview.push({ date, note, past: date <= today });
  }

  let pastCount = 0;
  for (let k = startMonth, g = 0; k && k <= monthKeyOf(today) && g < 600; k = addMonths(k, 1), g++) {
    if (hasEnd && endMonth && k > endMonth) break;
    const { year, month } = parseMonthKey(k);
    if (!skipped.includes(k) && recurringDate(year, month, day) <= today) pastCount++;
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = parseAmount(amount);
    if (!(value > 0)) return setError('Indiquez un montant supérieur à 0.');
    if (!startMonth) return setError('Choisissez le premier mois.');
    if (hasEnd && (!endMonth || endMonth < startMonth)) return setError('Le dernier mois doit être après le premier.');
    onSubmit({
      id: initial?.id ?? uid(),
      accountId,
      type,
      amount: value,
      label: label.trim() || categoryOf(type, category).label,
      category,
      day,
      startMonth,
      endMonth: hasEnd ? endMonth : null,
      skipped,
    });
    onClose();
  };

  return (
    <Modal
      title={initial ? 'Modifier l’automatique' : 'Opération automatique'}
      subtitle="Ajoutée chaque mois, sans y penser"
      onClose={onClose}
      accent={type}
      footer={<FormFooter onClose={onClose} onDelete={onDelete} submitLabel={initial ? 'Enregistrer' : 'Programmer'} tone={type === 'income' ? 'up' : 'down'} />}
    >
      <form id="modal-form" className="form" onSubmit={submit}>
        <TypeSwitch value={type} onChange={changeType} />
        <AmountInput value={amount} onChange={(v) => { setAmount(v); setError(''); }} type={type} error={!!error && !(parseAmount(amount) > 0)} />
        {error && <p className="form__error">{error}</p>}
        <Field label="Libellé">
          <input className="input" value={label} placeholder={type === 'income' ? 'Salaire' : 'Loyer'} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        </Field>

        <Field label={`Jour du mois : le ${day}`} hint="Samedi → vendredi précédent · Dimanche → lundi suivant">
          <div className="day-grid" role="radiogroup" aria-label="Jour du mois">
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <button type="button" key={d} role="radio" aria-checked={d === day} className={d === day ? 'is-active' : ''} onClick={() => changeDay(d)}>
                {d}
              </button>
            ))}
          </div>
        </Field>

        <div className="form__row">
          <Field label="Premier mois">
            <input
              className="input"
              type="month"
              value={startMonth}
              required
              onChange={(e) => {
                setStartMonth(e.target.value);
                setStartTouched(true);
              }}
            />
          </Field>
          <Field label="Dernier mois">
            <div className="input-combo">
              <label className="switch">
                <input type="checkbox" checked={hasEnd} onChange={(e) => setHasEnd(e.target.checked)} />
                <span />
              </label>
              {hasEnd ? (
                <input className="input" type="month" value={endMonth} min={startMonth} onChange={(e) => setEndMonth(e.target.value)} />
              ) : (
                <span className="muted">Sans fin</span>
              )}
            </div>
          </Field>
        </div>

        <div className="preview">
          <div className="preview__head">
            <RepeatIcon width={15} height={15} /> Prochaines échéances
            {pastCount > 0 && <span className="badge">{pastCount} déjà passée{plural(pastCount)}, comptée{plural(pastCount)} dans le solde</span>}
          </div>
          <ul>
            {preview.map((p) => (
              <li key={p.date} className={p.past ? 'is-past' : ''}>
                <span className="preview__date">{dayShort(p.date)}</span>
                {p.note && <span className="preview__note">{p.note}</span>}
                <span className={`preview__amount ${type === 'income' ? 'up' : 'down'}`}>
                  {type === 'income' ? '+' : '−'}{money(parseAmount(amount) > 0 ? parseAmount(amount) : 0)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {skipped.length > 0 && (
          <Field label="Mois ignorés">
            <div className="chips">
              {skipped.map((m) => (
                <button type="button" key={m} className="chip" onClick={() => setSkipped(skipped.filter((s) => s !== m))} title="Rétablir ce mois">
                  <SkipIcon width={14} height={14} /> {monthLabel(m)} <UndoIcon width={14} height={14} />
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label="Catégorie">
          <CategoryPicker type={type} value={category} onChange={setCategory} onCreate={onCreateCategory} />
        </Field>
        <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} />
      </form>
    </Modal>
  );
}

/* ---------- Compte ---------- */

interface AccountFormProps {
  initial?: Account;
  /** Le compte est-il actuellement le compte principal ? */
  primary: boolean;
  today: string;
  onSubmit: (a: Account, primary: boolean) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function AccountForm({ initial, primary, today, onSubmit, onDelete, onClose }: AccountFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [balance, setBalance] = useState(initial ? amountToInput(initial.initialBalance) : '');
  const [startDate, setStartDate] = useState(initial?.startDate ?? isoOf(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1));
  const [color, setColor] = useState(initial?.color ?? 'violet');
  const [isPrimary, setIsPrimary] = useState(primary);
  const [archived, setArchived] = useState(!!initial?.archived);
  const [error, setError] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Donnez un nom à ce compte.');
    const value = balance.trim() === '' ? 0 : parseAmount(balance.replace(/^−/, '-'));
    if (Number.isNaN(value)) return setError('Solde de départ invalide.');
    // `...initial` : on garde ce que le formulaire ne montre pas (numéros de compte des relevés importés).
    onSubmit(
      { ...initial, id: initial?.id ?? uid(), name: name.trim(), initialBalance: value, startDate, color, archived: archived || undefined },
      isPrimary && !archived,
    );
    onClose();
  };

  return (
    <Modal
      title={initial ? 'Modifier le compte' : 'Nouveau compte'}
      onClose={onClose}
      footer={<FormFooter onClose={onClose} onDelete={onDelete} submitLabel={initial ? 'Enregistrer' : 'Créer le compte'} tone="brand" />}
    >
      <form id="modal-form" className="form" onSubmit={submit}>
        <div className={`account-preview acct--${color}`}>
          <span>{name || 'Mon compte'}</span>
          <strong>{money(parseAmount(balance.replace(/^−/, '-')) || 0)}</strong>
        </div>
        {error && <p className="form__error">{error}</p>}
        <Field label="Nom du compte">
          <input data-autofocus className="input" value={name} placeholder="Compte courant, Livret A…" onChange={(e) => { setName(e.target.value); setError(''); }} maxLength={40} />
        </Field>
        <div className="form__row">
          <Field label="Solde de départ" hint="Peut être négatif (ex. -120)">
            <input className="input" inputMode="decimal" value={balance} placeholder="0,00" onChange={(e) => setBalance(e.target.value.replace(/[^\d.,\s\-−]/g, ''))} />
          </Field>
          <Field label="À la date du" hint="Le graphique commence ce mois-là">
            <input className="input" type="date" value={startDate} required onChange={(e) => setStartDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Couleur">
          <div className="swatches" role="radiogroup" aria-label="Couleur">
            {ACCOUNT_COLORS.map((c) => (
              <button
                type="button"
                key={c.id}
                role="radio"
                aria-checked={color === c.id}
                aria-label={c.label}
                title={c.label}
                className={`swatch acct--${c.id}${color === c.id ? ' is-active' : ''}`}
                onClick={() => setColor(c.id)}
              />
            ))}
          </div>
        </Field>
        <label className="toggle-row">
          <span className="toggle-row__text">
            <strong>Compte principal</strong>
            <small>Affiché en premier à l’ouverture de l’application.</small>
          </span>
          <span className="switch">
            <input type="checkbox" checked={isPrimary && !archived} disabled={archived} onChange={(e) => setIsPrimary(e.target.checked)} />
            <span />
          </span>
        </label>
        {initial && (
          <label className="toggle-row">
            <span className="toggle-row__text">
              <strong>Mettre ce compte de côté</strong>
              <small>
                Ancienne banque, compte clôturé… Il disparaît du bandeau et des totaux, mais ses opérations et son
                historique sont conservés. Réaffichez-le quand vous voulez par le menu ⋮.
              </small>
            </span>
            <span className="switch">
              <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
              <span />
            </span>
          </label>
        )}
      </form>
    </Modal>
  );
}

/* ---------- Échéance d'une opération automatique ---------- */

interface OccurrenceProps {
  entry: Entry;
  accountName?: string;
  onSkip: () => void;
  onEditRule: () => void;
  onClose: () => void;
}

export function OccurrenceSheet({ entry, accountName, onSkip, onEditRule, onClose }: OccurrenceProps) {
  const cat = categoryOf(entry.type, entry.category);
  return (
    <Modal title={entry.label} subtitle={dayFullLabel(entry.date)} onClose={onClose} accent={entry.type} size="sm">
      <div className="occurrence">
        <span className={`tx__icon tx__icon--lg ${entry.type === 'income' ? 'tx__icon--up' : 'tx__icon--down'}`}>{cat.icon}</span>
        <strong className={entry.type === 'income' ? 'up' : 'down'}>
          {entry.type === 'income' ? '+' : '−'}{money(entry.amount)}
        </strong>
        <p className="muted">
          Échéance automatique{accountName ? ` · ${accountName}` : ''}
        </p>
      </div>
      <div className="stack">
        <button className="btn btn--soft btn--block" data-autofocus onClick={onEditRule}>
          <RepeatIcon width={16} height={16} /> Modifier l’opération automatique
        </button>
        <button className="btn btn--ghost-danger btn--block" onClick={() => { onSkip(); onClose(); }}>
          <SkipIcon width={16} height={16} /> Ignorer pour {monthLabel(entry.monthKey ?? monthKeyOf(entry.date))}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- Début du mois ---------- */

interface PeriodFormProps {
  value: PeriodSetting;
  recurrings: Recurring[];
  accounts: Map<string, Account>;
  today: string;
  onSubmit: (period: PeriodSetting) => void;
  onClose: () => void;
}

export function PeriodForm({ value, recurrings, accounts, today, onSubmit, onClose }: PeriodFormProps) {
  const incomes = recurrings
    .filter((r) => r.type === 'income')
    .sort((a, b) => Number(b.category === 'salaire') - Number(a.category === 'salaire') || b.amount - a.amount);
  const [kind, setKind] = useState<PeriodSetting['kind']>(value.kind);
  const [ruleId, setRuleId] = useState(
    value.kind === 'rule' && incomes.some((r) => r.id === value.recurringId) ? value.recurringId : incomes[0]?.id ?? '',
  );
  const [day, setDay] = useState(value.kind === 'day' ? value.day : incomes[0]?.day ?? 5);

  const setting: PeriodSetting =
    kind === 'rule' && ruleId ? { kind: 'rule', recurringId: ruleId }
    : kind === 'day' ? { kind: 'day', day }
    : { kind: 'calendar' };

  // Aperçu : la période en cours et la suivante.
  const startDay = periodDay(setting, recurrings);
  const currentKey = periodKeyOf(today, startDay);
  const preview = [0, 1].map((offset) => {
    const key = addMonths(currentKey, offset);
    const start = periodStartDate(key, startDay);
    const next = parseISO(periodStartDate(addMonths(key, 1), startDay));
    next.setDate(next.getDate() - 1);
    const end = toISO(next);
    return { key, start, end, days: daysBetween(start, end) + 1 };
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(setting);
    onClose();
  };

  const option = (k: PeriodSetting['kind'], icon: string, title: string, text: string, extra?: ReactNode, disabled = false) => (
    <div className={`period-option${kind === k ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`}>
      <button type="button" role="radio" aria-checked={kind === k} disabled={disabled} onClick={() => setKind(k)}>
        <span className="period-option__icon" aria-hidden>{icon}</span>
        <span>
          <strong>{title}</strong>
          <small>{text}</small>
        </span>
        <span className="period-option__radio" aria-hidden />
      </button>
      {kind === k && extra}
    </div>
  );

  return (
    <Modal
      title="Début du mois"
      subtitle="Choisissez comment découper vos mois"
      onClose={onClose}
      footer={<FormFooter onClose={onClose} submitLabel="Enregistrer" tone="brand" />}
    >
      <form id="modal-form" className="form" onSubmit={submit}>
        <div className="period-options" role="radiogroup" aria-label="Découpage des mois">
          {option('calendar', '📅', 'Mois calendaire', 'Du 1er au dernier jour du mois.')}
          {option(
            'rule',
            '💼',
            'D’un salaire au suivant',
            incomes.length
              ? 'Le mois commence le jour où le revenu automatique est versé.'
              : 'Programmez d’abord votre salaire avec le bouton « Automatique ».',
            <div className="chips period-option__extra" role="radiogroup" aria-label="Revenu automatique">
              {incomes.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  role="radio"
                  aria-checked={ruleId === r.id}
                  className={`chip${ruleId === r.id ? ' is-active' : ''}`}
                  onClick={() => setRuleId(r.id)}
                >
                  {categoryOf('income', r.category).icon} {r.label} · le {r.day}
                  {accounts.size > 1 && <span className="muted"> · {accounts.get(r.accountId)?.name}</span>}
                </button>
              ))}
            </div>,
            incomes.length === 0,
          )}
          {option(
            'day',
            '🗓️',
            'Jour fixe',
            'Le mois commence toujours le même jour.',
            <div className="period-option__extra period-day">
              <span>Le</span>
              <select className="input" value={day} onChange={(e) => setDay(Number(e.target.value))} aria-label="Jour de début">
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <span>de chaque mois</span>
            </div>,
          )}
        </div>

        {kind !== 'calendar' && (
          <p className="field__hint">
            Comme pour les versements automatiques : un samedi, le mois commence le vendredi ; un dimanche, le lundi.
          </p>
        )}

        <div className="preview">
          <div className="preview__head">
            <RepeatIcon width={15} height={15} /> Aperçu
          </div>
          <ul>
            {preview.map((p, i) => (
              <li key={p.key}>
                <span className="preview__date">{i === 0 ? 'Mois en cours' : 'Mois suivant'}</span>
                <span className="preview__note preview__note--muted">{p.days} jours</span>
                <span className="preview__amount">
                  {dayShort(p.start)} → {dayShort(p.end)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </form>
    </Modal>
  );
}
