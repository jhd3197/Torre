import { useEffect, useRef, type ReactNode } from 'react';

/** A native modal <dialog> driven by `open`. Escape and backdrop close call `onClose`. */
export function Dialog({ id, open, onClose, children }: { id: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    }
  }, [open]);
  return <dialog id={id} ref={ref} onClose={() => { if (open) onClose(); }} onCancel={() => onClose()}>{open ? children : null}</dialog>;
}
