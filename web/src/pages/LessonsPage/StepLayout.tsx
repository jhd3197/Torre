import type { ReactNode } from 'react';
import type { StepReport } from '../../types';
import type { Cinema } from './cinema';

export interface StepProps<T> { step: T; onContinue: () => void; last: boolean; cinema: Cinema }
/** Interactive steps (play / choose / guess) also report their result for XP and stars. */
export interface ScoredProps<T> extends StepProps<T> { report: (result: StepReport) => void }

/** A step's frame: the board column (if any), the coach's panel, and the verdict bar. */
export function StepLayout({ board, bar, children }: { board: ReactNode; bar?: ReactNode; children: ReactNode }) {
  return (
    <div className={`lesson-layout${board ? '' : ' no-board'}`}>
      {board && <div className="lesson-board-column">{board}</div>}
      <div className="lesson-panel" aria-live="polite">{children}</div>
      {bar}
    </div>
  );
}
