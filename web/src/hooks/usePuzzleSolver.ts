// One puzzle being solved: the opponent's scripted replies, the solver's tries, hints and the solution reveal.
// PuzzlesPage's Solver and the story gauntlet share it and keep only their own panels.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { judgeMove, playMove, usePosition } from './useChess';
import { usePlanning } from './usePlanning';
import { sideToMove } from '../lib/format';
import { useToast } from '../state/AppData';
import type { Move, Puzzle } from '../types';

const SETUP_DELAY = 700; // let the solver see the position before the opponent moves
const REPLY_DELAY = 450;

/** How a solved puzzle went, for the attempt report. */
export interface PuzzleSolve { misses: string[]; hinted: boolean; revealed: boolean; seconds: number }

export interface PuzzleSolverOptions {
  /** The last move of the line landed (or any checkmate did). */
  onSolve?: (solve: PuzzleSolve) => void;
  /** A wrong try; `answer` is the move the line wanted. */
  onMiss?: (tried: string, answer: string) => void;
  /** A wrong try ends the puzzle (Streak and Storm). */
  endOnMiss?: boolean;
}

export function usePuzzleSolver(puzzle: Puzzle, { onSolve, onMiss, endOnMiss = false }: PuzzleSolverOptions = {}) {
  const toast = useToast();
  const line = useMemo(() => [puzzle.setup, ...puzzle.moves], [puzzle]);
  const [played, setPlayed] = useState<Move[]>([]);
  const [misses, setMisses] = useState<string[]>([]);
  const [wrong, setWrong] = useState<string | null>(null);
  /** A different move as strong as the puzzle's, mid-line: not a miss, but not the puzzle's idea. */
  const [alsoGood, setAlsoGood] = useState<string | null>(null);
  const [hinted, setHinted] = useState(false);
  const [revealed, setRevealed] = useState(false);
  // Hint and solution show for the current move only; the flags above keep that they were used.
  const [showHint, setShowHint] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const started = useRef(0);
  const { board, current } = usePosition(puzzle.fen, played);
  const planning = usePlanning(board);
  const solver = sideToMove(puzzle.fen) === 'white' ? 'black' : 'white';
  const solverTurn = played.length % 2 === 1;
  const expected = finished ? undefined : line[played.length];

  // The opponent's moves: the one that sets up the puzzle, then each reply after a short pause.
  useEffect(() => {
    if (finished || solverTurn || played.length >= line.length) return;
    const first = played.length === 0;
    const timer = setTimeout(() => {
      setPlayed(p => [...p, line[p.length]]);
      if (first) started.current = Date.now();
    }, first ? SETUP_DELAY : REPLY_DELAY);
    return () => clearTimeout(timer);
  }, [finished, solverTurn, played.length, line]);

  /** Seconds since the solver's clock started (after the setup move). */
  const elapsed = useCallback(() => (Date.now() - started.current) / 1000, []);

  function accept(move: Move, final: boolean) {
    setPlayed(p => [...p, move]);
    setWrong(null);
    setAlsoGood(null);
    setShowHint(false);
    setShowMove(false);
    if (!final) return;
    setFinished(true);
    onSolve?.({ misses, hinted, revealed, seconds: elapsed() });
  }

  async function onMove(uci: string) {
    if (finished || !solverTurn || !expected || busy) return;
    setAlsoGood(null);
    const final = played.length === line.length - 1;
    if (uci === expected.uci) return accept(expected, final);
    setBusy(true);
    try {
      // Any checkmate solves the puzzle, even a different or faster one.
      const after = await playMove(puzzle.fen, played, uci);
      if (after.termination === 'checkmate') return accept({ uci, san: after.san }, true);
      // A move Stockfish rates as good as the puzzle's is never a miss: on the last move it solves
      // the puzzle, mid-line the reader is asked for the puzzle's move (its replies follow that one).
      const judged = await judgeMove(puzzle.fen, played, uci, expected.uci).catch(() => null);
      if (judged?.verdict === 'good') {
        if (final) return accept({ uci, san: after.san }, true);
        setAlsoGood(after.san);
        return;
      }
      setMisses(m => [...m, after.san]);
      setWrong(after.san);
      if (endOnMiss) setFinished(true);
      onMiss?.(after.san, expected.san);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function hint() { setHinted(true); setShowHint(true); }
  function reveal() { setRevealed(true); setShowMove(true); }
  function retry() {
    setPlayed([]); setMisses([]); setWrong(null); setAlsoGood(null); setHinted(false); setRevealed(false);
    setShowHint(false); setShowMove(false); setFinished(false);
  }

  return {
    line, played, misses, wrong, alsoGood, hinted, revealed, showHint, showMove, busy, finished,
    board, current, planning, solver, solverTurn, expected, elapsed,
    clean: finished && !misses.length && !hinted && !revealed,
    onMove, hint, reveal, retry, clearWrong: () => setWrong(null),
  };
}
