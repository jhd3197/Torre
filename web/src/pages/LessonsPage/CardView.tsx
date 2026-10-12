// A concept card (Torre Lesson Screens, "Concept card"): the idea in a sentence or two, a few
// points with icons, and a diagram. Back and Next page through the lesson; so do the arrow keys.
import { Fragment, useEffect, useEffectEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChessBoard } from '../../components/ChessBoard';
import { usePosition } from '../../hooks/useChess';
import { usePlanning } from '../../hooks/usePlanning';
import { pieceSrc, usePieceSet } from '../../lib/pieces';
import type { CardStep, Move } from '../../types';
import { useAutoplayStart } from './cinema';
import { useLessonPlace } from './LessonChrome';
import { StepLayout, type StepProps } from './StepLayout';

const NO_MOVES: Move[] = [];
const PIECE = /^[KQRBNPkqrbnp]$/;

/** `**word**` in card text is the term being taught, set in bold. */
export function emphasis(text: string) {
  return text.split(/\*\*(.+?)\*\*/).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>));
}

export function CardIcon({ icon }: { icon: string | null }) {
  const set = usePieceSet();
  if (!icon) return null;
  return PIECE.test(icon) ? <img src={pieceSrc(icon, set)} alt="" /> : <span aria-hidden="true">{icon}</span>;
}

export function CardView({ step, onContinue, last, cinema }: StepProps<CardStep>) {
  const { t } = useTranslation('lessons');
  const place = useLessonPlace();
  const { board } = usePosition(step.fen ?? '', NO_MOVES, !!step.fen);
  const planning = usePlanning(board);
  const back = place?.back;

  // Arrow keys page through cards, unless focus is on a control that uses them.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && el.closest('input, select, textarea, [contenteditable="true"]')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); onContinue(); }
    else if (e.key === 'ArrowLeft' && back) { e.preventDefault(); back(); }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Autoplay: the coach reads the card, then the lesson turns the page.
  useAutoplayStart(cinema.autoplay, () => cinema.speak({ narration: step.narration ?? step.text.replace(/\*\*/g, '') }, onContinue));

  return (
    <StepLayout step={step} cinema={cinema}
      bar={{
        primary: { label: last ? t('step.finish') : t('card.next'), onClick: onContinue },
        secondary: back ? [{ label: t('card.back'), onClick: back }] : [],
      }}
      board={step.fen && <ChessBoard board={board} flipped={step.orientation === 'black'} planning={planning} movable={false}
        annotations={step.marks} highlight={step.highlight} />}>
      <p className="card-text">{emphasis(step.text)}</p>
      {step.points.length > 0 && (
        <ul className="card-points">
          {step.points.map((point, i) => (
            <li key={i}><span className="card-point-icon"><CardIcon icon={point.icon} /></span>{point.label}</li>
          ))}
        </ul>
      )}
    </StepLayout>
  );
}
