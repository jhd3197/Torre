// The duolingo-style feedback footer: a neutral bar with ONE primary action while
// the user is answering, a full-width colored banner once an answer is committed
// (green "Nicely done!" / rose "Try again."). Lessons, puzzles and drills share it.
import { useEffect, useRef, type ReactNode } from 'react';

export type Verdict = 'neutral' | 'correct' | 'wrong';

export interface VerdictAction { label: string; onClick: () => void; disabled?: boolean }

export interface VerdictBarProps {
  verdict?: Verdict;
  /** Headline once committed ("Nicely done!" / "Try again."). */
  title?: ReactNode;
  /** Optional explanation under the headline (the option's `why`, the move that was played…). */
  explanation?: ReactNode;
  /** The one primary button: Check → Retry / Next → Continue. Disabled until an answer is committed. */
  primary?: VerdictAction;
  /** Helpers ("Show a hint", "Show the move"), demoted to text links. */
  secondary?: VerdictAction[];
}

export function VerdictBar({ verdict = 'neutral', title, explanation, primary, secondary = [] }: VerdictBarProps) {
  const primaryRef = useRef(primary);
  primaryRef.current = primary;

  // Enter is always the primary action while the bar is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      const action = primaryRef.current;
      if (!action || action.disabled) return;
      if (document.querySelector('dialog[open]')) return;
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.closest('button, a, input, select, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      action.onClick();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const committed = verdict !== 'neutral';
  return (
    <div className={`verdict-bar verdict-${verdict}`} role={committed || title ? 'status' : undefined}>
      {/* A neutral bar can still carry a note (a good move that is not the lesson's). */}
      {(title || explanation) && (
        <div className="verdict-body">
          {title && <strong className="verdict-title">{title}</strong>}
          {explanation && <span className="verdict-why">{explanation}</span>}
        </div>
      )}
      <div className="verdict-actions">
        {secondary.map(action => (
          <button key={action.label} type="button" className="text-button" disabled={action.disabled} onClick={action.onClick}>
            {action.label}
          </button>
        ))}
        {primary && (
          <button type="button" className="button primary squishy verdict-primary" disabled={primary.disabled} onClick={primary.onClick}>
            {primary.label}
          </button>
        )}
      </div>
    </div>
  );
}
