// Pure board interactions. Legal moves always come from python-chess.
import i18n from '../i18n';
import type { BoardState, SquareControl } from '../types';

type Pieces = Pick<BoardState, 'pieces'>;
type WithLegal = Pieces & Pick<BoardState, 'legal'>;

export interface Mark { from: string; to: string; kind?: 'move' | 'note' | 'circle' }

const isWhite = (piece: string) => piece === piece.toUpperCase();

/** The legal castling move a king/rook drop describes, if any. */
export function castleMove(board: WithLegal, from: string, to: string): string | null {
  const a = board.pieces[from], b = board.pieces[to];
  if (!a || !b || isWhite(a) !== isWhite(b)) return null;
  const pair = a.toLowerCase() + b.toLowerCase();
  if (pair !== 'kr' && pair !== 'rk') return null;
  const king = a.toLowerCase() === 'k' ? from : to;
  const rook = a.toLowerCase() === 'r' ? from : to;
  const rank = isWhite(a) ? '1' : '8';
  if (king !== 'e' + rank || !['a' + rank, 'h' + rank].includes(rook)) return null;
  const move = king + (rook[0] === 'h' ? 'g' : 'c') + rank;
  return board.legal.includes(move) ? move : null;
}

export function isCastleGesture(board: Pieces, from: string, to: string): boolean {
  const a = board.pieces[from], b = board.pieces[to];
  return !!a && !!b && isWhite(a) === isWhite(b) && ['kr', 'rk'].includes(a.toLowerCase() + b.toLowerCase());
}

/** Square centre in an 800×800 board drawing. */
export function center(square: string, flipped: boolean) {
  const file = square.charCodeAt(0) - 97, rank = Number(square[1]) - 1;
  return { x: (flipped ? 7 - file : file) * 100 + 50, y: (flipped ? rank : 7 - rank) * 100 + 50 };
}

export function toggleMark(marks: Mark[], from: string, to: string, details: Partial<Mark> = {}): Mark[] {
  const exists = marks.some(m => m.from === from && m.to === to);
  return exists ? marks.filter(m => m.from !== from || m.to !== to) : [...marks, { from, to, ...details }];
}

export type PlanResult = { allowed: true; kind: 'circle' | 'note' | 'move' } | { allowed: false; reason: string };

export function plan(board: Partial<BoardState> & Pieces, from: string, to: string, freeform = false): PlanResult {
  if (from === to) return { allowed: true, kind: 'circle' };
  if (!board.pieces[from]) return freeform ? { allowed: true, kind: 'note' }
    : { allowed: false, reason: i18n.t('board:plan.startOnPiece') };
  const targets = board.plans?.[from] ?? (board.legal ?? []).filter(m => m.startsWith(from)).map(m => m.slice(2, 4));
  return targets.includes(to) || castleMove({ pieces: board.pieces, legal: board.legal ?? [] }, from, to)
    ? { allowed: true, kind: 'move' }
    : { allowed: false, reason: i18n.t('board:plan.illegal') };
}

/** SVG path for an arrow; knight moves bend at a right angle along the long leg first. */
/**
 * An arrow's line from square to square. `trim` stops the line short of the target's centre, so a
 * marker head drawn from the line's end (refX 0) finishes on the square instead of past it.
 */
export function arrowPath(board: Pieces | null, from: string, to: string, flipped = false, trim = 0): string {
  const a = center(from, flipped), b = center(to, flipped);
  const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  const knight = board?.pieces[from]?.toLowerCase() === 'n' && ((dx === 200 && dy === 100) || (dx === 100 && dy === 200));
  const corner = knight ? (dx > dy ? { x: b.x, y: a.y } : { x: a.x, y: b.y }) : a;
  const length = Math.hypot(b.x - corner.x, b.y - corner.y) || 1;
  const end = { x: b.x - (b.x - corner.x) / length * trim, y: b.y - (b.y - corner.y) / length * trim };
  const round = (n: number) => Math.round(n * 10) / 10;
  return knight
    ? `M${a.x},${a.y} L${corner.x},${corner.y} L${round(end.x)},${round(end.y)}`
    : `M${a.x},${a.y} L${round(end.x)},${round(end.y)}`;
}

export function heat(control: SquareControl | undefined) {
  const white = control?.white.length ?? 0, black = control?.black.length ?? 0;
  const kind = white && black ? 'contested' : white ? 'white' : black ? 'black' : 'neutral';
  return { kind, strength: Math.min(3, Math.max(white, black)), white, black } as const;
}

/** Board squares in display order (a8…h1, or h1…a8 when flipped). */
export function squareOrder(flipped: boolean): string[] {
  const files = flipped ? 'hgfedcba' : 'abcdefgh', ranks = flipped ? '12345678' : '87654321';
  return [...ranks].flatMap(rank => [...files].map(file => file + rank));
}

const PIECE_KEYS = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' } as const;

/** Lowercase piece names by letter, in the chosen language (read on every access). */
export const pieceNames: Record<string, string> = Object.defineProperties({} as Record<string, string>,
  Object.fromEntries(Object.entries(PIECE_KEYS).map(([letter, key]) => [letter, { enumerable: true, get: () => i18n.t(`board:pieces.${key}`) }])));

export function describePiece(piece: string | undefined, square: string): string {
  if (!piece) return i18n.t('board:square.empty', { square });
  const key = PIECE_KEYS[piece.toLowerCase() as keyof typeof PIECE_KEYS];
  // One sentence per piece and colour: other languages agree the colour with the piece.
  return i18n.t(`board:square.${isWhite(piece) ? 'white' : 'black'}.${key}`, { square });
}

export const ownsPiece = (piece: string | undefined, turn: 'white' | 'black') => !!piece && isWhite(piece) === (turn === 'white');

/** Pieces of a FEN as a 64-cell array, a8 first. */
export function fenCells(fen: string): string[] {
  return fen.split(' ')[0].split('/').flatMap(rank => [...rank].flatMap(c => /[1-8]/.test(c) ? Array<string>(Number(c)).fill('') : [c]));
}
