// The review's verdict on the move just played: its grade, the engine's top choices from the position
// before it, and where the move played ranks among them ("3 better moves were there"). Hovering a row
// shows the position before the move with that row's move drawn on it.
import { useEffect, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { cachedBoard, reviewedResult } from '../../hooks/useChess';
import { Mascot, type MascotPose } from '../Reward';
import { CursorRook } from '../CursorRook';
import { api } from '../../lib/api';
import { GRADE_INFO, gradeIcon, gradeOf } from '../../lib/grades';
import { scoreLabel, startPly } from '../../lib/format';
import { whyItWorks } from '../../lib/whyItWorks';
import type { AnalyzedMove, Color, EngineLine, Move } from '../../types';

const ROWS = 4; // the engine's top three and the move played: the verdict keeps this height on every move

/** Hidden rows that hold the verdict's height when it has fewer than ROWS to show. */
const blanks = (count: number) => Array.from({ length: Math.max(0, count) }, (_, i) => (
  <li key={`blank-${i}`} aria-hidden="true">
    <button type="button" className="blank" tabIndex={-1} disabled><span>&nbsp;</span><b>&nbsp;</b><em /></button>
  </li>
));

/** The verdict's place while there is no reviewed move to show (the start, or a move not reviewed yet). */
/** `pose` shows that still pose; without one, the rook that watches the cursor stands there. */
export function EmptyVerdict({ title, hint, pose }: { title: string; hint: string; pose?: MascotPose }) {
  return (
    <div className="move-verdict verdict-idle" role="status">
      <div className="verdict-head">
        <div><strong>{title}</strong><p>{hint}</p></div>
      </div>
      {/* The rook stands where the picks will be, so the verdict keeps its height. */}
      <div className="verdict-idle-stage">
        <ol className="verdict-picks">{blanks(ROWS)}</ol>
        {pose ? <Mascot pose={pose} size={140} /> : <CursorRook size={150} />}
      </div>
    </div>
  );
}

/** A line's score for the side that moved: higher is better for them, mates beyond any centipawns. */
const forMover = (line: EngineLine, white: boolean) =>
  (line.mate != null ? Math.sign(line.mate) * (100000 - Math.abs(line.mate)) : line.cp) * (white ? 1 : -1);

/** A score as the side that moved sees it (the engine reports White's view): +1.90 is good for them. */
const moverLabel = (line: EngineLine, white: boolean) =>
  scoreLabel(white ? line : { ...line, cp: -line.cp, mate: line.mate == null ? null : -line.mate });

export function MoveVerdict({ initialFen, moves, cursor, judged, bestUci, engineId, onGo, onPreview, voice, you, action, note }: {
  initialFen: string;
  moves: Move[];
  cursor: number;
  judged: AnalyzedMove;
  /** Stockfish's choice in the position before this move. */
  bestUci?: string | null;
  /** The engine whose review lines to rank the move against. */
  engineId?: string;
  onGo: (ply: number) => void;
  /** Show the position before the move with this move (a UCI) on it; null puts the board back. */
  onPreview?: (uci: string | null) => void;
  /** Whether the coach says each move out loud, and the switch for it. */
  voice?: { on: boolean; onToggle: () => void };
  /** Your side: the move played is labelled "You" on your moves and "Played" on theirs. */
  you?: Color;
  /** A small button beside the grade (the game page's "Share this move"). */
  action?: ReactNode;
  /** A line under the grade (the game page's celebration of a brilliant move). */
  note?: ReactNode;
}) {
  const { t } = useTranslation('board');
  const grade = gradeOf(judged);
  const info = GRADE_INFO[grade];
  const slipped = grade === 'inaccuracy' || grade === 'mistake' || grade === 'blunder';
  const [bestSan, setBestSan] = useState<string | null>(null);

  const ply = startPly(initialFen) + cursor - 1;
  const number = `${Math.floor(ply / 2) + 1}${ply % 2 ? '…' : '.'}`;
  const moverWhite = ply % 2 === 0;
  const playedLabel = !you || (you === 'white') === moverWhite ? t('verdict.you') : t('verdict.played');
  const played = moves[cursor - 1];
  // The review's top lines before the move, and its score after it, ranked for the side that moved.
  const picks = reviewedResult(initialFen, moves, cursor - 1, engineId)?.lines.slice(0, 3) ?? [];
  const after = reviewedResult(initialFen, moves, cursor, engineId)?.lines[0];
  const rank = picks.findIndex(line => line.uci[0] === played?.uci);
  const better = rank >= 0 ? rank : after ? picks.filter(line => forMover(line, moverWhite) > forMover(after, moverWhite)).length : picks.length;
  const why = whyItWorks(t, {
    grade, picks, moverWhite, played,
    before: cachedBoard(initialFen, moves, cursor - 1), after: cachedBoard(initialFen, moves, cursor),
    previous: cursor > 1 ? moves[cursor - 2] : undefined, earlier: cursor > 1 ? cachedBoard(initialFen, moves, cursor - 2) : undefined,
  });

  // Without review lines, name the better move from the saved best move instead.
  useEffect(() => {
    setBestSan(null);
    if (!slipped || !bestUci || picks.length) return;
    const controller = new AbortController();
    const line = [...moves.slice(0, cursor - 1).map(m => m.uci), bestUci];
    api<{ moves: Move[] }>('api/line', { initialFen, moves: line }, controller.signal)
      .then(result => { if (result.moves.length === line.length) setBestSan(result.moves.at(-1)!.san); }, () => {});
    return () => controller.abort();
  }, [initialFen, moves, cursor, bestUci, slipped, picks.length]);

  return (
    <div className={`move-verdict grade-${grade}`} role="status" aria-live="polite">
      <div className="verdict-head">
        <img key={`${grade}-${cursor}`} src={gradeIcon(grade)} alt="" width="36" height="36" />
        <div>
          <strong>{t('verdict.is', { number, san: judged.san, grade: info.label })}</strong>
          <p>{why ?? info.message}</p>
          {(picks.length > 0 || slipped) && (
            <p className="verdict-better">
              {picks.length > 0
                ? <>{rank >= 0 ? t('verdict.pick', { rank: rank + 1 }) : t('verdict.better', { count: better })}{' '}</>
                : bestSan ? <><Trans t={t} i18nKey="verdict.preferred" values={{ san: bestSan }} components={{ b: <b /> }} />{' '}</> : null}
              {slipped && <button type="button" className="text-button" aria-label={t('verdict.showBefore')} title={t('verdict.showBefore')}
                onClick={() => onGo(cursor - 1)}>{t('verdict.seeBefore')}</button>}
            </p>
          )}
        </div>
        {voice && (
          <button type="button" className="icon-button verdict-voice" aria-pressed={voice.on} onClick={voice.onToggle}
            title={t(voice.on ? 'verdict.voiceOff' : 'verdict.voiceOn')} aria-label={t(voice.on ? 'verdict.voiceOff' : 'verdict.voiceOn')}>
            {voice.on ? '🔊' : '🔇'}
          </button>
        )}
        {action}
      </div>
      {note}
      <ol className="verdict-picks" onMouseLeave={() => onPreview?.(null)}>
        {picks.map((line, i) => (
          <li key={line.uci[0]}>
            <button type="button" className={i === rank ? 'played' : undefined} title={t('verdict.previewTitle')}
              onMouseEnter={() => onPreview?.(line.uci[0])} onFocus={() => onPreview?.(line.uci[0])} onBlur={() => onPreview?.(null)}>
              <span>{i === rank ? playedLabel : i + 1}</span><b>{line.moves[0]}</b><em>{moverLabel(line, moverWhite)}</em>
            </button>
          </li>
        ))}
        {rank < 0 && played && (
          <li>
            <button type="button" className={`played${after && better ? ' worse' : ''}`} title={t('verdict.previewTitle')}
              onMouseEnter={() => onPreview?.(played.uci)} onFocus={() => onPreview?.(played.uci)} onBlur={() => onPreview?.(null)}>
              <span>{playedLabel}</span><b>{played.san}</b><em>{after ? moverLabel(after, moverWhite) : ''}</em>
            </button>
          </li>
        )}
        {blanks(ROWS - picks.length - (rank < 0 && played ? 1 : 0))}
      </ol>
    </div>
  );
}
