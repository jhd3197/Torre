// The board screens on a phone: a slim header, the moves as one swipeable row, and big thumb buttons.
import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { startPly } from '../../lib/format';
import { GRADE_INFO, gradeIcon, gradeOf, marked } from '../../lib/grades';
import type { AnalyzedMove, Move } from '../../types';

export interface PhoneHeadProps {
  title: ReactNode;
  sub?: ReactNode;
  /** Where the back arrow goes. */
  back: string;
  /** Extra buttons beside Flip (a review's More menu). */
  tools?: ReactNode;
}

const chevron = (d: string) => (
  <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
export const BACK_ICON = chevron('m15 18-6-6 6-6');
export const NEXT_ICON = chevron('m9 18 6-6-6-6');
const FLIP_ICON = (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3v15" /><path d="M4.5 14.5 8 18l3.5-3.5" /><path d="M16 21V6" /><path d="M12.5 9.5 16 6l3.5 3.5" />
  </svg>
);

/** Back on the left, the game's name in the middle, Flip on the right. */
export function PhoneHead({ title, sub, back, tools, onFlip }: PhoneHeadProps & { onFlip: () => void }) {
  const { t } = useTranslation('board');
  return (
    <header className="phone-head">
      <Link className="phone-icon-button" to={back} aria-label={t('phone.back')}>{BACK_ICON}</Link>
      <div className="phone-head-title">
        <h1 id="page-title">{title}</h1>
        {sub && <span>{sub}</span>}
      </div>
      {tools}
      <button type="button" className="phone-icon-button" id="flip" title={t('workspace.flipTitle')} aria-label={t('workspace.flip')} onClick={onFlip}>{FLIP_ICON}</button>
    </header>
  );
}

const ACTION_ICONS = {
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  flag: <><path d="M4 22V4" /><path d="M4 4h12l-2 4 2 4H4" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  repeat: <><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></>,
  trophy: <><path d="M8 21h8" /><path d="M12 17v4" /><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3v2a3 3 0 0 1-3 3" /><path d="M7 5H4v2a3 3 0 0 0 3 3" /></>,
  exit: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>,
  back: <path d="m15 18-6-6 6-6" />,
};

/** One of a game's bottom buttons: an icon over a short word. A `to` makes it a link. */
export function PhoneAction({ icon, label, onClick, to, tone, id, disabled }: {
  icon: keyof typeof ACTION_ICONS; label: string; onClick?: () => void; to?: string; tone?: 'primary' | 'danger'; id?: string; disabled?: boolean;
}) {
  const body = <>
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{ACTION_ICONS[icon]}</svg>
    {label}
  </>;
  const className = `phone-action${tone ? ` ${tone}` : ''}`;
  return to
    ? <Link className={className} id={id} to={to}>{body}</Link>
    : <button type="button" className={className} id={id} onClick={onClick} disabled={disabled}>{body}</button>;
}

/** Every move as a chip in one row that scrolls sideways, the current one kept in view. */
export function MoveStrip({ initialFen, moves, cursor, onSelect, judgments }: {
  initialFen: string; moves: Move[]; cursor: number; onSelect: (ply: number) => void; judgments?: Map<number, AnalyzedMove>;
}) {
  const { t } = useTranslation('board');
  const ref = useRef<HTMLOListElement>(null);
  const first = startPly(initialFen);

  useEffect(() => {
    const strip = ref.current, current = strip?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!strip) return;
    // Keep the current move in the middle, or the newest at the end while playing on.
    const left = current ? current.offsetLeft - strip.clientWidth / 2 + current.offsetWidth / 2 : 0;
    strip.scrollTo?.({ left, behavior: 'smooth' });
  }, [cursor, moves.length]);

  if (!moves.length) return <p className="move-strip empty">{t('phone.movesEmpty')}</p>;
  return (
    <ol className="move-strip" ref={ref} aria-label={t('moves.label')}>
      {moves.map((move, i) => {
        const ply = first + i, n = Math.floor(ply / 2) + 1, white = ply % 2 === 0;
        const judged = judgments?.get(i + 1), grade = judged ? gradeOf(judged) : null;
        const kind = grade && marked(grade) ? grade : null;
        const current = cursor === i + 1;
        return (
          <li key={i}>
            <button type="button" aria-current={current ? 'step' : undefined} className={kind ? `move-${kind}` : undefined}
              aria-label={t('moves.goTo', { number: n, san: move.san, grade: kind ? `, ${t(`grades.${kind}.short`)}` : '' })}
              onClick={() => onSelect(i + 1)}>
              {(white || i === 0) && <span className="move-strip-number">{white ? `${n}.` : `${n}…`}</span>}
              {move.san}
              {kind && <img src={gradeIcon(kind)} alt={GRADE_INFO[kind].symbol} width="16" height="16" />}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
