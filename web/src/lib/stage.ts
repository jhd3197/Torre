// The video stage's board model. Pieces keep an id from the moment a position
// is loaded, so a move slides the same element across the board instead of
// swapping images. No legality checks: the recorder plays moves that came out
// of a real game or an engine line.

export interface StagePiece {
  id: number;
  /** FEN letter: uppercase White, lowercase Black. */
  symbol: string;
  /** 0 = a8 … 63 = h1, the order FEN lists squares in. */
  square: number;
}

export interface StagePosition {
  pieces: StagePiece[];
  turn: 'w' | 'b';
  /** En passant target square from the last double pawn push, or null. */
  ep: number | null;
}

const FILES = 'abcdefgh';

export function squareIndex(name: string): number {
  const file = FILES.indexOf(name[0]);
  const rank = Number(name[1]);
  if (file < 0 || !(rank >= 1 && rank <= 8)) throw new Error(`bad square: ${name}`);
  return (8 - rank) * 8 + file;
}

export const squareName = (index: number) => `${FILES[index % 8]}${8 - Math.floor(index / 8)}`;

let nextId = 1;

export function fromFen(fen: string): StagePosition {
  const [placement, turn = 'w', , ep = '-'] = fen.trim().split(/\s+/);
  const pieces: StagePiece[] = [];
  let square = 0;
  for (const ch of placement) {
    if (ch === '/') continue;
    if (/\d/.test(ch)) square += Number(ch);
    else pieces.push({ id: nextId++, symbol: ch, square: square++ });
  }
  return { pieces, turn: turn === 'b' ? 'b' : 'w', ep: ep === '-' ? null : squareIndex(ep) };
}

/** Play a UCI move (e2e4, e7e8q, e1g1 castles). Returns the new position and
 *  the captured piece, if any. */
export function applyUci(pos: StagePosition, uci: string): { position: StagePosition; captured: StagePiece | null } {
  const from = squareIndex(uci.slice(0, 2));
  const to = squareIndex(uci.slice(2, 4));
  const promo = uci[4];
  const mover = pos.pieces.find(p => p.square === from);
  if (!mover) throw new Error(`no piece on ${uci.slice(0, 2)} for ${uci}`);

  const kind = mover.symbol.toLowerCase();
  const white = mover.symbol === mover.symbol.toUpperCase();
  let capturedSquare = to;
  if (kind === 'p' && to === pos.ep && from % 8 !== to % 8) capturedSquare = to + (white ? 8 : -8);
  const captured = pos.pieces.find(p => p.square === capturedSquare && p.id !== mover.id) ?? null;

  let pieces = pos.pieces
    .filter(p => p !== captured)
    .map(p => (p.id === mover.id
      ? { ...p, square: to, symbol: promo ? (white ? promo.toUpperCase() : promo.toLowerCase()) : p.symbol }
      : p));

  // Castling: the king moves two files, the rook jumps over it.
  if (kind === 'k' && Math.abs(to - from) === 2) {
    const rookFrom = to > from ? from + 3 : from - 4;
    const rookTo = to > from ? from + 1 : from - 1;
    pieces = pieces.map(p => (p.square === rookFrom && p.symbol.toLowerCase() === 'r' ? { ...p, square: rookTo } : p));
  }

  const ep = kind === 'p' && Math.abs(to - from) === 16 ? (from + to) / 2 : null;
  return { position: { pieces, turn: pos.turn === 'w' ? 'b' : 'w', ep }, captured };
}

/** White's winning chances (0–100) from a centipawn eval, Lichess's curve. */
export function whiteWinPct(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Mates arrive as ±(10000 − moves to mate), python-chess's score(mate_score=10000); ±10000 is mate on the board. */
export function evalLabel(cp: number): string {
  if (Math.abs(cp) >= 9000) {
    const moves = 10000 - Math.abs(cp);
    return moves <= 0 ? '#' : `M${moves}`;
  }
  return `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;
}
