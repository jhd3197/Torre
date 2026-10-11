// The rook mascot reacting to the game as it happens: captures, checks, castling, waiting.
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { Mascot, type MascotPose } from './Reward';
import { useNarration } from '../hooks/useNarration';
import { captureOf, captureLine, type Capture } from '../lib/commentary';
import { sideToMove, startPly } from '../lib/format';
import type { BoardState, Color, Move } from '../types';
import { quietCoach } from '../lib/settings';

/** How long you can think before the rook gets sleepy, in milliseconds. */
export const IDLE_MS = 45_000;

/** `spoken`: a moment worth saying out loud (a capture, a check, mate, a lost piece), not just showing. */
export interface CoachMood { pose: MascotPose; line: string; spoken?: boolean }

/** One of the coach's quips for a moment (voice.json), varied by how far the game has gone. */
const quip = (moment: string, ply: number) => {
  const lines = i18n.t(`voice:${moment}`, { returnObjects: true }) as string[];
  return Array.isArray(lines) && lines.length ? lines[ply % lines.length] : '';
};

/** The rook's reaction to the latest move. Pure, so it is easy to test. `capture` names what the
 *  move took and whether it was free, when the boards around it are known. */
export function coachMood({ initialFen, moves, you, botName, thinking, reviewing, idle, capture, enPassant = false }: {
  initialFen: string; moves: Move[]; you: Color; botName: string; thinking: boolean; reviewing: boolean; idle: boolean;
  capture?: Capture | null;
  /** The last move took en passant, a rule that looks like a bug the first time. */
  enPassant?: boolean;
}): CoachMood {
  const say = (pose: MascotPose, key: string): CoachMood => ({ pose, line: i18n.t(`board:coachRook.${key}`, { bot: botName }) });
  if (reviewing) return say('detective', 'reviewing');
  if (thinking) return say('thinking', 'botThinking');
  const last = moves.at(-1);
  if (!last) return say('wink', 'start');
  const first = sideToMove(initialFen);
  const mover: Color = (moves.length - 1) % 2 === 0 ? first : first === 'white' ? 'black' : 'white';
  const san = last.san;
  const spoken = (pose: MascotPose, moment: string): CoachMood => ({ pose, line: quip(moment, moves.length), spoken: true });
  if (enPassant) return say('magnify', mover === you ? 'enPassantYou' : 'enPassantBot');
  if (mover === you) {
    if (san.includes('#')) return spoken('trophy', 'mate');
    if (san.includes('=')) return say('confetti', 'promoted');
    if (san.startsWith('O-O')) return say('shield', 'castled');
    if (san.includes('+')) return spoken('starry', 'check');
    if (san.includes('x')) return capture ? { pose: 'excited', line: captureLine(capture, you), spoken: true } : spoken('excited', 'capture');
    return say('content', 'moved');
  }
  if (san.includes('+')) return say('panic', 'inCheck');
  if (san.includes('x')) return capture ? { pose: 'shocked', line: captureLine(capture, you), spoken: true } : spoken('shocked', 'lostPiece');
  if (idle) return say('bored', 'idle');
  return say('determined', 'yourTurn');
}

export function CoachRook({ board, ...props }: Omit<Parameters<typeof coachMood>[0], 'idle' | 'capture'> & {
  /** The live position, which tells what a capture took and whether it was free. */
  board?: BoardState | null;
}) {
  useTranslation('board'); // re-render when the language changes
  const [idle, setIdle] = useState(false);
  const count = props.moves.length;
  useEffect(() => {
    setIdle(false);
    const timer = setTimeout(() => setIdle(true), IDLE_MS);
    return () => clearTimeout(timer);
  }, [count]);
  // The board after each move, by move count, so a capture can be read off the boards around it.
  const boards = useRef(new Map<number, BoardState>());
  const base = startPly(props.initialFen);
  if (board && startPly(board.fen) - base >= 0) boards.current.set(startPly(board.fen) - base, board);
  // A takeback or a new game leaves boards from moves no longer played: drop them.
  for (const ply of boards.current.keys()) if (ply > count) boards.current.delete(ply);
  const last = props.moves.at(-1);
  const from = last?.uci.slice(0, 2) ?? '', to = last?.uci.slice(2, 4) ?? '';
  const before = boards.current.get(count - 1);
  const stored = boards.current.get(count);
  // The board after must be the one this move made (not one left from a move taken back).
  const after = stored && stored.pieces[to] && !stored.pieces[from] ? stored : undefined;
  const capture = last?.san.includes('x') && before && after ? captureOf(before, after, last.uci) : null;
  // A pawn that captured onto an empty square took en passant.
  const enPassant = !!last?.san.includes('x') && !!before && before.pieces[from]?.toLowerCase() === 'p' && !before.pieces[to];
  const mood = coachMood({ ...props, idle, capture, enPassant });
  const quiet = quietCoach.use();
  const coach = useNarration();
  // Captures, checks, mate and a lost piece are said out loud, once per move. A capture waits for
  // the board after it, to say what it took; anything else is said at once.
  const said = useRef(count);
  const waiting = !!last?.san.includes('x') && !after;
  // The quiet coach keeps its quips to the bubble; nothing is said aloud.
  const sayMood = useEffectEvent(() => { if (mood.spoken && mood.line && !quiet) coach.speak({ narration: mood.line }); });
  useEffect(() => {
    if (said.current === count || waiting) return;
    said.current = count;
    sayMood();
  }, [count, waiting]);
  return (
    <div className="coach-rook" aria-live="polite">
      <Mascot key={mood.pose} pose={mood.pose} size={64} />
      <p className="coach-bubble">{mood.line}</p>
    </div>
  );
}
