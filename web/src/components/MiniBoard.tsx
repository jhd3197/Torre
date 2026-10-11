import { fenCells } from '../lib/boardTools';
import { pieceSrc, usePieceSet } from '../lib/pieces';

const SYMBOLS: Record<string, string> = { '♔': 'K', '♕': 'Q', '♖': 'R', '♗': 'B', '♘': 'N', '♙': 'P', '♚': 'k', '♛': 'q', '♜': 'r', '♝': 'b', '♞': 'n', '♟': 'p' };

/** A small static board from a FEN (or a grid of piece letters / symbols). */
export function MiniBoard({ fen, grid }: { fen?: string; grid?: string[][] }) {
  const cells = fen ? fenCells(fen) : (grid ?? []).flat().map(p => SYMBOLS[p] ?? p);
  const pieceSet = usePieceSet();
  return (
    <div className={`insight-board pieces-${pieceSet}`} aria-hidden="true">
      {cells.map((piece, i) => (
        <span key={i} className={(Math.floor(i / 8) + i % 8) % 2 ? 'dark' : ''}>
          {/^[KQRBNPkqrbnp]$/.test(piece) && <img src={pieceSrc(piece, pieceSet)} alt="" loading="lazy" />}
        </span>
      ))}
    </div>
  );
}
