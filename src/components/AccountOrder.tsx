import { useRef, useState, type PointerEvent } from 'react';
import type { Account } from '../lib/types';
import { ChevronDown, ChevronUp, GripIcon } from './Icons';
import { Modal } from './Modal';

interface Props {
  accounts: Account[];
  onSubmit: (ids: string[]) => void;
  onClose: () => void;
}

/** Réorganisation des comptes du bandeau : glisser la poignée, ou flèches haut / bas. */
export function AccountOrderForm({ accounts, onSubmit, onClose }: Props) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const [order, setOrder] = useState(() => accounts.map((a) => a.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const move = (id: string, to: number) =>
    setOrder((current) => {
      const from = current.indexOf(id);
      if (from < 0 || from === to || to < 0 || to >= current.length) return current;
      const next = [...current];
      next.splice(from, 1);
      next.splice(to, 0, id);
      return next;
    });

  const startDrag = (id: string) => (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragId(id);
  };

  // La ligne glissée prend la place de celle dont le milieu est dépassé.
  const drag = (e: PointerEvent<HTMLButtonElement>) => {
    if (!dragId || !listRef.current) return;
    const rows = [...listRef.current.children];
    let target = rows.length - 1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        target = i;
        break;
      }
    }
    move(dragId, target);
  };

  const endDrag = () => setDragId(null);

  return (
    <Modal
      title="Ordre des comptes"
      subtitle="Faites glisser un compte ou utilisez les flèches"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
          <button
            className="btn btn--primary"
            onClick={() => {
              onSubmit(order);
              onClose();
            }}
          >
            Enregistrer
          </button>
        </>
      }
    >
      <p className="field__hint order-hint">« Tous les comptes » reste toujours en premier.</p>
      <ol className="order-list" ref={listRef}>
        {order.map((id, i) => {
          const a = byId.get(id);
          if (!a) return null;
          return (
            <li key={id} className={`order-row${dragId === id ? ' is-dragging' : ''}`}>
              <button
                type="button"
                className="order-row__grip"
                aria-label={`Déplacer ${a.name}`}
                onPointerDown={startDrag(id)}
                onPointerMove={drag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    move(id, i + (e.key === 'ArrowUp' ? -1 : 1));
                  }
                }}
              >
                <GripIcon width={18} height={18} />
              </button>
              <span className={`order-row__swatch acct--${a.color}`} aria-hidden />
              <span className="order-row__name">{a.name}</span>
              <span className="order-row__pos">{i + 1}</span>
              <button type="button" className="icon-btn" onClick={() => move(id, i - 1)} disabled={i === 0} aria-label={`Monter ${a.name}`}>
                <ChevronUp width={18} height={18} />
              </button>
              <button type="button" className="icon-btn" onClick={() => move(id, i + 1)} disabled={i === order.length - 1} aria-label={`Descendre ${a.name}`}>
                <ChevronDown width={18} height={18} />
              </button>
            </li>
          );
        })}
      </ol>
    </Modal>
  );
}
