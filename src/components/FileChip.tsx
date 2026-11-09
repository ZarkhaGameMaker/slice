import type { ReactNode } from 'react';
import type { FileStatus } from '../lib/dataFile';
import { AlertIcon, CheckIcon, LockIcon, SaveIcon } from './Icons';

interface Props {
  name: string | null;
  status: FileStatus | null;
  savedAt: number | null;
  autoSave: boolean;
  onClick: () => void;
}

const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });

function when(ms: number) {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? `à ${timeFmt.format(d)}` : `le ${dateFmt.format(d)} à ${timeFmt.format(d)}`;
}

/** Indicateur du fichier de comptes, à côté du nom de l'application. */
export function FileChip({ name, status, savedAt, autoSave, onClick }: Props) {
  if (!name || !status) {
    return (
      <button className="file-chip is-none" onClick={onClick} title="Enregistrer vos comptes dans un fichier de votre ordinateur (Ctrl+S)">
        <span className="file-chip__icon"><SaveIcon width={15} height={15} /></span>
        <span className="file-chip__text">
          <strong>Enregistrer</strong>
          <small>dans un fichier</small>
        </span>
      </button>
    );
  }

  const saved = savedAt ? ` ${when(savedAt)}` : '';
  // Modifié avec l'enregistrement automatique : il part dans un instant, on l'affiche déjà en cours.
  const shown: FileStatus = status === 'dirty' && autoSave ? 'saving' : status;
  const view: Record<FileStatus, { icon: ReactNode; label: string; title: string }> = {
    saved: {
      icon: <CheckIcon width={14} height={14} strokeWidth={2.6} />,
      label: `Enregistré${saved}`,
      title: autoSave ? 'Chaque modification est enregistrée dans ce fichier' : 'Ctrl+S pour enregistrer',
    },
    dirty: { icon: <i className="file-chip__dot" />, label: 'Non enregistré', title: 'Cliquez (ou Ctrl+S) pour enregistrer' },
    saving: { icon: <i className="file-chip__spin" />, label: 'Enregistrement…', title: 'Enregistrement en cours' },
    locked: {
      icon: <LockIcon width={14} height={14} />,
      label: 'Cliquez pour autoriser',
      title: 'Le navigateur demande votre accord avant de modifier ce fichier',
    },
    conflict: { icon: <AlertIcon width={14} height={14} />, label: 'Modifié ailleurs', title: 'Cliquez pour choisir la version à garder' },
    missing: {
      icon: <AlertIcon width={14} height={14} />,
      label: 'Introuvable · Enregistrer sous…',
      title: 'Le fichier a été déplacé ou supprimé : cliquez pour choisir où enregistrer',
    },
    error: { icon: <AlertIcon width={14} height={14} />, label: 'Échec · réessayer', title: 'Cliquez pour réessayer' },
  };
  const { icon, label, title } = view[shown];

  return (
    <button className={`file-chip is-${shown}`} onClick={onClick} title={`${name}\n${title}`} aria-label={`${name} : ${label}`}>
      <span className="file-chip__icon">{icon}</span>
      <span className="file-chip__text">
        <strong>{name}</strong>
        <small>{label}</small>
      </span>
    </button>
  );
}
