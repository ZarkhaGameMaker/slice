import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './Icons';

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  accent?: 'income' | 'expense' | 'brand';
  size?: 'sm' | 'md' | 'lg';
}

export function Modal({ title, subtitle, onClose, children, footer, accent = 'brand', size = 'md' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const first = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]');
    first?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        className={`modal modal--${size} modal--${accent}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal__grab" aria-hidden />
        <header className="modal__header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <CloseIcon />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  /** Second choix, entre « Annuler » et la confirmation (ex. « Fermer sans enregistrer »). */
  altLabel?: string;
  onAlt?: () => void;
  /** `danger` pour une action destructrice, `primary` sinon. */
  tone?: 'danger' | 'primary';
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose, altLabel, onAlt, tone = 'danger' }: ConfirmProps) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      size={altLabel ? 'md' : 'sm'}
      accent={tone === 'danger' ? 'expense' : 'brand'}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>Annuler</button>
          {altLabel && onAlt && (
            <button
              className="btn btn--ghost"
              onClick={() => {
                onAlt();
                onClose();
              }}
            >
              {altLabel}
            </button>
          )}
          <button
            className={`btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}`}
            data-autofocus
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-text">{message}</p>
    </Modal>
  );
}
