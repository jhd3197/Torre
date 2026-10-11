// Board drawings: legal-move arrows (right-drag, or two taps in draw mode) and circles.
import { useCallback, useEffect, useState } from 'react';
import { plan, toggleMark, type Mark } from '../lib/boardTools';
import type { BoardState } from '../types';

export interface Planning {
  marks: Mark[];
  drawMode: boolean;
  freeform: boolean;
  drawStart: string | null;
  drag: { from: string; to: string } | null;
  setFreeform: (on: boolean) => void;
  toggleDrawMode: () => void;
  clear: () => void;
  /** Start of a right-drag or the first tap in draw mode. */
  begin: (square: string) => void;
  extend: (square: string) => void;
  cancel: () => void;
  /** Finish a right-drag. Returns an explanation when the drawing is not allowed. */
  commitDrag: (square: string | null) => string | null;
  /** A tap in draw mode. */
  tap: (square: string) => string | null;
}

export function usePlanning(board: BoardState | null): Planning {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [drawMode, setDrawMode] = useState(false);
  const [freeform, setFreeform] = useState(false);
  const [drawStart, setDrawStart] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: string; to: string } | null>(null);

  // Drawings describe one position; a new position starts clean.
  const fen = board?.fen;
  useEffect(() => { setMarks([]); setDrawStart(null); setDrag(null); }, [fen]);

  const commit = useCallback((from: string, to: string): string | null => {
    if (!board) return null;
    const result = plan(board, from, to, freeform);
    if (!result.allowed) return result.reason;
    setMarks(current => toggleMark(current, from, to, { kind: result.kind }));
    return null;
  }, [board, freeform]);

  return {
    marks, drawMode, freeform, drawStart, drag,
    setFreeform: on => { setFreeform(on); setDrawStart(null); setDrag(null); },
    toggleDrawMode: () => { setDrawMode(on => !on); setDrawStart(null); },
    clear: () => { setMarks([]); setDrawStart(null); setDrag(null); },
    begin: square => setDrag({ from: square, to: square }),
    extend: square => setDrag(current => current && { ...current, to: square }),
    cancel: () => setDrag(null),
    commitDrag: square => {
      const from = drag?.from;
      setDrag(null);
      return from && square ? commit(from, square) : null;
    },
    tap: square => {
      if (!drawStart) { setDrawStart(square); return null; }
      setDrawStart(null);
      return commit(drawStart, square);
    },
  };
}
