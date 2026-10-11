// The Home hero's picture: the piece the next lesson teaches, standing on a
// small board with every square it can reach marked. Pressing START makes it
// hop to one of those squares before the lesson opens (see HomePage).
import type { CSSProperties } from 'react';
import { pieceSrc, usePieceSet } from '../lib/pieces';

const SIZE = 5; // a 5×5 window is enough to show every basic move pattern
const C = 2; // the piece stands in the middle

type Piece = 'R' | 'B' | 'Q' | 'N' | 'K' | 'P';
const PIECES: Record<string, Piece> = { rook: 'R', bishop: 'B', queen: 'Q', knight: 'N', king: 'K', pawn: 'P' };

/** The piece a basics lesson is about ("the-knight" → N), or null for any other lesson. */
export function lessonPiece(slug: string | undefined): Piece | null {
  const m = slug?.match(/^the-(rook|bishop|queen|knight|king|pawn)$/);
  return m ? PIECES[m[1]] : null;
}

const LINES: Record<Piece, [number, number][]> = {
  R: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  B: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  Q: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],
  N: [], K: [], P: [],
};
const STEPS: Record<Piece, [number, number][]> = {
  N: [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]],
  K: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],
  P: [[-1, 0], [-2, 0]],
  R: [], B: [], Q: [],
};

/** Reachable squares as [row, col], in a fixed reading order so they light up in sequence. */
export function reach(piece: Piece): [number, number][] {
  const out: [number, number][] = [];
  const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < SIZE && c < SIZE;
  for (const [dr, dc] of LINES[piece]) for (let k = 1; inside(C + dr * k, C + dc * k); k++) out.push([C + dr * k, C + dc * k]);
  for (const [dr, dc] of STEPS[piece]) if (inside(C + dr, C + dc)) out.push([C + dr, C + dc]);
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

export function PieceStage({ piece, hop }: { piece: Piece; hop: boolean }) {
  const pieceSet = usePieceSet();
  const targets = reach(piece);
  // The hop lands on the first target in reading order: up and to the side for most pieces.
  const [tr, tc] = targets[0];
  const order = new Map(targets.map(([r, c], i) => [r * SIZE + c, i]));
  return (
    <div className={`piece-stage${hop ? ' hop' : ''}`} aria-hidden="true"
      style={{ '--hop-x': `${(tc - C) * 100}%`, '--hop-y': `${(tr - C) * 100}%` } as CSSProperties}>
      {Array.from({ length: SIZE * SIZE }, (_, i) => {
        const r = Math.floor(i / SIZE), c = i % SIZE;
        const n = order.get(i);
        return (
          <span key={i} className={`${(r + c) % 2 ? 'dark' : ''}${n !== undefined ? ' reach' : ''}${r === tr && c === tc ? ' target' : ''}`}
            style={n !== undefined ? { '--n': n } as CSSProperties : undefined}>
            {r === C && c === C && <img className="piece-stage-piece" src={pieceSrc(piece, pieceSet)} alt="" />}
          </span>
        );
      })}
    </div>
  );
}
