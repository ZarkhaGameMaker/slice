import { useEffect } from 'react';
import { UndoIcon } from './Icons';

export interface ToastData {
  id: number;
  message: string;
  onUndo?: () => void;
}

export function Toast({ toast, onDone }: { toast: ToastData | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(onDone, toast.onUndo ? 5500 : 3000);
    return () => window.clearTimeout(t);
  }, [toast, onDone]);

  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.id}>
      <span>{toast.message}</span>
      {toast.onUndo && (
        <button
          className="toast__undo"
          onClick={() => {
            toast.onUndo?.();
            onDone();
          }}
        >
          <UndoIcon width={15} height={15} /> Annuler
        </button>
      )}
    </div>
  );
}
