// Typed moves (Settings → Accessibility → Type moves): SAN as people write it ("e4", "Nf3", "exd5",
// "Rad1", "e8=Q", "O-O") or a UCI pair ("e2e4"), matched against the position's legal moves.
import type { BoardState } from '../types';

type Position = Pick<BoardState, 'pieces' | 'legal' | 'turn'>;

const SAN = /^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([QRBN]))?$/;

/** Piece letters as written in a language, where they differ from English (Spanish: Cf3, Dxd5, R for the king). */
export const PIECE_LETTERS: Record<string, Record<string, string>> = {
  es: { R: 'K', D: 'Q', T: 'R', A: 'B', C: 'N' },
};

/** The legal UCI move the text names, or null when it names none or more than one. */
export function typedMove(board: Position, input: string, lang = 'en'): string | null {
  // Check and mate marks, annotations and a zero for the letter O are all forgiven.
  let text = input.trim().replace(/[+#!?]+$/, '').replace(/0/g, 'O');
  if (!text) return null;
  const uci = text.toLowerCase();
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
    if (board.legal.includes(uci)) return uci;
    // A promotion typed without its piece becomes a queen.
    return uci.length === 4 && board.legal.includes(`${uci}q`) ? `${uci}q` : null;
  }
  if (/^O-O(-O)?$/i.test(text)) {
    const rank = board.turn === 'white' ? '1' : '8';
    const move = `e${rank}${text.length > 3 ? 'c' : 'g'}${rank}`;
    return board.pieces[`e${rank}`]?.toLowerCase() === 'k' && board.legal.includes(move) ? move : null;
  }
  const letters = PIECE_LETTERS[lang.slice(0, 2)];
  // Pieces written in the language's own letters; only capitals, since a, c and d are also files.
  if (letters) {
    const own = (letter: string) => letters[letter] ?? letter;
    text = text.replace(/^[A-Z]/, own).replace(/(=?)([A-Z])$/, (_, mark: string, letter: string) => mark + own(letter));
  }
  // A lowercase piece letter reads as the piece ("nf3"), except b, which is also a file.
  else if (/^[nrqk]/.test(text)) text = text[0].toUpperCase() + text.slice(1);
  const match = SAN.exec(text.replace(/=?([qrbn])$/, (_, p: string) => `=${p.toUpperCase()}`));
  if (!match) return null;
  const [, piece = 'P', file, rank, to, promotion] = match;
  const found = board.legal.filter(move => {
    const moving = board.pieces[move.slice(0, 2)];
    if (move.slice(2, 4) !== to || moving?.toUpperCase() !== piece) return false;
    if ((file && move[0] !== file) || (rank && move[1] !== rank)) return false;
    return move.length === 5 ? move[4] === (promotion ?? 'Q').toLowerCase() : !promotion;
  });
  return found.length === 1 ? found[0] : null;
}
