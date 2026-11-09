import { useState, type FormEvent } from 'react';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../lib/categories';
import { uid } from '../lib/store';
import type { CustomCategory, TxType } from '../lib/types';
import { CheckIcon, PlusIcon, TrashIcon } from './Icons';
import { Modal } from './Modal';

/** Emojis proposés ; on peut aussi en taper un autre dans le champ. */
const EMOJIS = [
  '🛒', '🍽️', '☕', '🍺', '🏠', '🔑', '💡', '🧹',
  '🚗', '⛽', '🚆', '🚲', '✈️', '🏖️', '🏥', '💊',
  '💇', '👗', '🎁', '🎬', '🎮', '🎵', '📚', '🏋️',
  '⚽', '🐶', '🐱', '👶', '🎓', '💼', '🧾', '🔧',
  '📱', '💻', '🐷', '📈', '💶', '💳', '🪴', '✨',
];

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
/** Garde un seul emoji, même composé (drapeau, emoji avec variante…). */
const oneEmoji = (s: string) => [...s].slice(0, 3).join('') || '✨';

interface FieldsProps {
  icon: string;
  label: string;
  onIcon: (v: string) => void;
  onLabel: (v: string) => void;
  autoFocus?: boolean;
}

/** Les deux champs d'une catégorie : son emoji et son nom. */
function CategoryFields({ icon, label, onIcon, onLabel, autoFocus }: FieldsProps) {
  return (
    <>
      <div className="cat-fields">
        <input
          className="input cat-fields__icon"
          value={icon}
          onChange={(e) => onIcon(oneEmoji(e.target.value))}
          aria-label="Emoji de la catégorie"
        />
        <input
          className="input"
          value={label}
          placeholder="Nom de la catégorie"
          maxLength={24}
          autoFocus={autoFocus}
          onChange={(e) => onLabel(e.target.value)}
          aria-label="Nom de la catégorie"
        />
      </div>
      <div className="cat-emojis" role="radiogroup" aria-label="Choisir un emoji">
        {EMOJIS.map((e) => (
          <button
            type="button"
            key={e}
            role="radio"
            aria-checked={icon === e}
            aria-label={e}
            className={`cat-emoji${icon === e ? ' is-active' : ''}`}
            onClick={() => onIcon(e)}
          >
            {e}
          </button>
        ))}
      </div>
    </>
  );
}

interface NewProps {
  type: TxType;
  onCreate: (category: CustomCategory) => void;
  onCancel: () => void;
}

/** Création rapide, dépliée sous les catégories d'un formulaire d'opération. */
export function NewCategory({ type, onCreate, onCancel }: NewProps) {
  const [icon, setIcon] = useState('✨');
  const [label, setLabel] = useState('');

  const create = () => {
    const name = clean(label);
    if (!name) return;
    onCreate({ id: `c:${uid()}`, label: name, icon, type });
  };

  return (
    <div className="cat-new">
      <CategoryFields icon={icon} label={label} onIcon={setIcon} onLabel={setLabel} autoFocus />
      <div className="cat-new__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          Annuler
        </button>
        <button type="button" className="btn btn--primary btn--sm" disabled={!clean(label)} onClick={create}>
          <PlusIcon width={15} height={15} /> Créer la catégorie
        </button>
      </div>
    </div>
  );
}

interface ManagerProps {
  categories: CustomCategory[];
  /** Nombre d'opérations qui utilisent chaque catégorie. */
  counts: Map<string, number>;
  onAdd: (category: CustomCategory) => void;
  onUpdate: (category: CustomCategory) => void;
  onDelete: (category: CustomCategory) => void;
  onClose: () => void;
}

/** Fenêtre « Catégories » : créer, renommer et supprimer ses propres catégories. */
export function CategoryManager({ categories, counts, onAdd, onUpdate, onDelete, onClose }: ManagerProps) {
  const [type, setType] = useState<TxType>('expense');
  const [editing, setEditing] = useState<CustomCategory | null>(null);
  const [icon, setIcon] = useState('✨');
  const [label, setLabel] = useState('');
  const [confirm, setConfirm] = useState(false);

  const isIncome = type === 'income';
  const mine = categories.filter((c) => c.type === type);
  const base = isIncome ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const edit = (c: CustomCategory | null) => {
    setEditing(c);
    setIcon(c?.icon ?? '✨');
    setLabel(c?.label ?? '');
    setConfirm(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = clean(label);
    if (!name) return;
    if (editing) onUpdate({ ...editing, label: name, icon });
    else onAdd({ id: `c:${uid()}`, label: name, icon, type });
    edit(null);
  };

  const used = editing ? (counts.get(editing.id) ?? 0) : 0;

  return (
    <Modal
      title="Catégories"
      subtitle="Créez les vôtres, en plus de celles fournies."
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn btn--ghost" onClick={onClose}>Fermer</button>
          <button type="submit" form="modal-form" className="btn btn--primary" disabled={!clean(label)}>
            {editing ? 'Enregistrer' : 'Ajouter'}
          </button>
        </>
      }
    >
      <form id="modal-form" className="form" onSubmit={submit}>
        <div className="segmented segmented--sm" role="tablist" aria-label="Type de catégorie">
          <button
            type="button"
            role="tab"
            aria-selected={!isIncome}
            className={!isIncome ? 'is-active' : ''}
            onClick={() => { setType('expense'); edit(null); }}
          >
            Dépenses
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isIncome}
            className={isIncome ? 'is-active' : ''}
            onClick={() => { setType('income'); edit(null); }}
          >
            Revenus
          </button>
        </div>

        <div className="cat-group">
          <span className="cat-group__title">
            Vos catégories {mine.length > 0 && <small>cliquez pour modifier</small>}
          </span>
          {mine.length === 0 ? (
            <p className="cat-group__empty">
              Aucune pour l’instant. Choisissez un emoji, donnez un nom, puis « Ajouter ».
            </p>
          ) : (
            <div className="chips">
              {mine.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className={`chip${editing?.id === c.id ? ' is-active' : ''}`}
                  onClick={() => edit(editing?.id === c.id ? null : c)}
                >
                  <span aria-hidden>{c.icon}</span> {c.label}
                  <small className="chip__count">{counts.get(c.id) ?? 0}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="cat-group">
          <span className="cat-group__title">
            {editing ? `Modifier « ${editing.label} »` : 'Nouvelle catégorie'}
          </span>
          <CategoryFields icon={icon} label={label} onIcon={setIcon} onLabel={setLabel} />
          {editing && (
            <div className="cat-danger">
              {confirm ? (
                <>
                  <span>
                    {used === 0
                      ? 'Supprimer cette catégorie ?'
                      : `${used} opération${used > 1 ? 's' : ''} ${used > 1 ? 'passeront' : 'passera'} dans « Autre ».`}
                  </span>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirm(false)}>
                    Annuler
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    onClick={() => {
                      onDelete(editing);
                      edit(null);
                    }}
                  >
                    <CheckIcon width={15} height={15} /> Confirmer
                  </button>
                </>
              ) : (
                <>
                  <span>Catégorie créée par vous</span>
                  <button type="button" className="btn btn--ghost-danger btn--sm" onClick={() => setConfirm(true)}>
                    <TrashIcon width={15} height={15} /> Supprimer
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="cat-group">
          <span className="cat-group__title">Fournies avec l’application</span>
          <div className="chips cat-group__base">
            {base.map((c) => (
              <span key={c.id} className="chip is-static">
                <span aria-hidden>{c.icon}</span> {c.label}
              </span>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}
