// A button that shares a game or one of its moves through a page's useShare(): a torre.sh link
// when hosted, the page's fallback (copying the PGN) when not.
import type { ReactNode } from 'react';
import type { Sharer } from '../hooks/useShare';
import type { ShareRequest } from '../lib/share';

export function ShareButton({ sharer, request, children, className = 'button', id, title, label }: {
  sharer: Sharer;
  /** Built on click, so the title and text follow the move shown at that moment. */
  request: () => ShareRequest;
  children: ReactNode;
  className?: string;
  id?: string;
  title?: string;
  /** The accessible name, for a button that shows only an icon. */
  label?: string;
}) {
  return (
    <button type="button" className={className} id={id} title={title} aria-label={label} disabled={sharer.busy}
      aria-busy={sharer.busy || undefined} onClick={() => void sharer.share(request())}>
      {children}
    </button>
  );
}

/** A box with an arrow leaving it: the usual sign for sharing. */
export function ShareIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 3v12" /><path d="M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}
