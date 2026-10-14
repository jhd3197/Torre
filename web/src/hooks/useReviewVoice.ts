// The review out loud: stepping onto a reviewed move has the coach say what it was ("Blunder! The best
// move was knight takes on f5.", "Trading queens."), with a free piece, a missed mate, the opening and
// a long think called out. The words are recorded lines (lib/commentary.ts) played back to back.
import { useEffect, useEffectEvent, useMemo, useRef } from 'react';
import { cachedBoard, reviewedResult } from './useChess';
import { useNarration } from './useNarration';
import { reviewVoice } from '../lib/settings';
import { captureOf, clockEventOf, evalEventOf, hangsOf, openingFamily, reviewLines, sacrificeOf, themeOf, type MoveReview } from '../lib/commentary';
import { startPly } from '../lib/format';
import { gradeOf } from '../lib/grades';
import type { AnalyzedMove, BoardState, Grade, Move } from '../types';

const COSTLY: Grade[] = ['miss', 'mistake', 'blunder'];
const FIRST_CAPTURE_PLY = 16;
/** The commentary plays a little faster than recorded, so stepping through a game keeps its pace. */
export const REVIEW_RATE = 1.25;

/** How many earlier positions with the same side to move match the one after move `ply`. */
function repetitions(initialFen: string, moves: Move[], ply: number, after: BoardState): number {
  const key = (fen: string) => fen.split(' ').slice(0, 4).join(' ');
  let count = 0;
  for (let earlier = ply - 2; earlier >= 0; earlier -= 2) {
    const board = earlier === 0 ? { fen: initialFen } : cachedBoard(initialFen, moves, earlier);
    if (board && key(board.fen) === key(after.fen)) count++;
  }
  return count;
}

export function useReviewVoice({ enabled, initialFen, moves, cursor, judgments, before, after, engineId, opening, thinkTimes, longThink, startClock, result, brief = false }: {
  /** Speak at all: a replay, with the review not playing through the game. */
  enabled: boolean;
  initialFen: string;
  moves: Move[];
  cursor: number;
  judgments?: Map<number, AnalyzedMove>;
  /** The positions before and after the move at the cursor, once loaded. */
  before: BoardState | null;
  after: BoardState | null;
  engineId: string;
  opening?: { ply: number; name: string } | null;
  thinkTimes?: (number | null)[];
  longThink?: number;
  /** Each side's clock at the start, in seconds, when the game has a time control. */
  startClock?: number | null;
  /** The game's result ("1-0", "0-1", "1/2-1/2"), said on its last move. */
  result?: string | null;
  /** Only the highlights: the game is playing through on its own (autoplay). */
  brief?: boolean;
}) {
  const narrator = useNarration();
  const on = reviewVoice.use();

  // The first move after the opening book, said once as the game leaves it.
  const outOfBook = useMemo(() => {
    let seenBook = false;
    for (const ply of [...(judgments?.keys() ?? [])].sort((a, b) => a - b)) {
      const book = gradeOf(judgments!.get(ply)!) === 'book';
      if (seenBook && !book) return ply;
      seenBook ||= book;
    }
    return null;
  }, [judgments]);

  const judged = cursor > 0 ? judgments?.get(cursor) : undefined;
  const played = moves[cursor - 1];
  const previous = cursor > 1 ? judgments?.get(cursor - 1) : undefined;
  const ready = !!(judged && played && before && after);
  // What there is to say about the move; the words are drawn only when it is said.
  const review = useMemo((): MoveReview | null => {
    if (!ready) return null;
    const sign = (startPly(initialFen) + cursor - 1) % 2 === 0 ? 1 : -1;
    const top = reviewedResult(initialFen, moves, cursor - 1, engineId)?.lines[0];
    const next = reviewedResult(initialFen, moves, cursor, engineId)?.lines[0];
    // Mate was on the board for the mover, and after the move it is gone.
    const mate = top?.mate != null && top.mate * sign > 0 ? top.mate * sign : null;
    const kept = played.san.includes('#') || top?.uci[0] === played.uci || (next?.mate != null && next.mate * sign > 0);
    return {
      san: played.san, grade: gradeOf(judged!), capture: captureOf(before!, after!, played.uci),
      theme: themeOf(played.san, played.uci, before!, after!, moves[cursor - 2], startPly(initialFen) + cursor, moves[cursor - 3]),
      sacrifice: sacrificeOf(before!, after!, played.uci),
      repetition: repetitions(initialFen, moves, cursor, after!),
      hangs: hangsOf(before!, after!, played.uci),
      evalEvent: top && next ? evalEventOf(top, next, sign > 0, reviewedResult(initialFen, moves, cursor - 2, engineId)?.lines[0]) : null,
      moverWhite: sign > 0,
      answersSlip: !!previous && COSTLY.includes(gradeOf(previous)),
      // The first capture is worth a word only after eight quiet moves each.
      firstCapture: played.san.includes('x') && cursor > FIRST_CAPTURE_PLY && !moves.slice(0, cursor - 1).some(m => m.san.includes('x')),
      result: cursor === moves.length ? result : null,
      // The mover's clock after this move and after their previous one (the start clock before their first).
      clockEvent: clockEventOf(played.clock, cursor >= 3 ? moves[cursor - 3].clock : startClock),
      bestSan: top && top.uci[0] !== played.uci ? top.moves[0] : null,
      missedMate: mate && !kept ? mate : null,
      opening: opening && opening.ply === cursor ? openingFamily(opening.name) : null,
      outOfBook: cursor === outOfBook,
      thinkSeconds: thinkTimes?.[cursor - 1] ?? null, longThink,
    };
  }, [ready, initialFen, moves, cursor, engineId, judged, played, before, after, opening, outOfBook, thinkTimes, longThink, startClock, result, previous]);

  // A step waits here until its move's data is in, then is said once. The position the page opens
  // on is not said; stepping is what asks for the commentary.
  const pending = useRef<number | null>(null);
  const stepped = useRef(cursor);
  const { speak, stop } = narrator;
  // A step, not a change of data, starts a line.
  const onStep = useEffectEvent(() => {
    stop();
    pending.current = enabled ? cursor : null;
  });
  useEffect(() => {
    if (stepped.current === cursor) return;
    stepped.current = cursor;
    onStep();
  }, [cursor]);
  useEffect(() => {
    if (pending.current !== cursor || !review) return;
    pending.current = null;
    const lines = on ? reviewLines(review, brief) : [];
    if (lines.length) speak({ parts: lines, rate: REVIEW_RATE });
  }, [cursor, review, on, brief, speak]);

  return {
    on,
    speaking: narrator.speaking,
    toggle: () => { if (on) narrator.stop(); reviewVoice.set(!on); },
  };
}
