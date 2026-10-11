// Piece images for every board, in the chosen set. Symbols are FEN letters: uppercase White, lowercase Black.
import { createSetting } from './settings';

/** Staunton (the default) and clay are the studio's own sets; classic is the flat SVG set. */
export const PIECE_SETS = ['staunton', 'clay', 'classic'] as const;
export type PieceSet = typeof PIECE_SETS[number];

export const pieceSet = createSetting<PieceSet>('chess-jd-piece-set', 'staunton', PIECE_SETS);
export const usePieceSet = pieceSet.use;
export const setPieceSet = pieceSet.set;
export const resetPieceSet = pieceSet.reset;

export function pieceSrc(symbol: string, set: PieceSet): string {
  if (set !== 'classic') return `art/pieces/${set === 'clay' ? 'board' : set}/${symbol === symbol.toUpperCase() ? 'w' : 'b'}${symbol.toUpperCase()}.webp`;
  return `pieces/${symbol}.svg`; // served by studio.py
}

/** Display pieces for dialogs and lessons. */
export const figureSrc = (color: 'white' | 'black', figure: 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn' | 'resigned' | 'winner') =>
  `art/pieces/${color}-${figure}.webp`;
