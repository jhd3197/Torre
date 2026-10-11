// A page's own pieces in the shared top bar: `lead` takes the title's place (a back link), `tools` sits
// beside Help (flip, a More menu). Layout owns the bar and provides the two spots; a page renders
// <TopbarSlot> anywhere and its children are portalled there while the page is shown.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface TopbarSlots { lead: HTMLElement | null; tools: HTMLElement | null }

export const TopbarSlotsContext = createContext<TopbarSlots>({ lead: null, tools: null });

export function TopbarSlot({ slot, children }: { slot: keyof TopbarSlots; children: ReactNode }) {
  const target = useContext(TopbarSlotsContext)[slot];
  return target ? createPortal(children, target) : null;
}

/** A "More" button whose menu holds a page's less frequent actions; it closes on a choice, a click away or Esc. */
export function MoreMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: globalThis.MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="more-menu" ref={ref}>
      <button type="button" className="icon-button more-button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(!open)}><span aria-hidden="true">•••</span></button>
      {open && <div className="more-items" role="menu" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}
