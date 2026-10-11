// The board's own settings: coordinates, legal-move dots, dragging, auto-queen, typed moves and
// screen-reader announcements.
import { fireEvent, render, screen } from '@testing-library/react';
import { ChessBoard } from './ChessBoard';
import { usePlanning } from '../hooks/usePlanning';
import { AppDataProvider } from '../state/AppData';
import { PromotionProvider } from '../state/Promotion';
import { announceMoves, autoQueen, coordinates, dragPieces, legalDots, typedMoves } from '../lib/settings';
import { fakeServer } from '../test/harness';
import type { BoardState } from '../types';

// White to move: a pawn about to promote, and the two kings.
const BOARD: BoardState = {
  fen: 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1', turn: 'white', pieces: { a8: 'k', e7: 'P', e1: 'K' },
  legal: ['e7e8q', 'e7e8r', 'e7e8b', 'e7e8n', 'e1d1', 'e1f1', 'e1d2', 'e1e2', 'e1f2'],
  check: null, result: null, termination: null, plans: {}, control: {},
};

function Board({ onMove, lastMove }: { onMove: (uci: string) => void; lastMove?: string }) {
  const planning = usePlanning(BOARD);
  return <ChessBoard board={BOARD} flipped={false} planning={planning} movable="turn" onMove={onMove} lastMove={lastMove} />;
}

function renderBoard(lastMove?: string) {
  fakeServer();
  const onMove = vi.fn();
  const view = render(<AppDataProvider><PromotionProvider><Board onMove={onMove} lastMove={lastMove} /></PromotionProvider></AppDataProvider>);
  const square = (name: string) => view.container.querySelector<HTMLElement>(`[data-square="${name}"]`)!;
  return { ...view, onMove, square };
}

test('coordinates and legal-move dots follow their settings', () => {
  const { container, square } = renderBoard();
  expect(container.querySelectorAll('.coordinate')).toHaveLength(16);
  fireEvent.click(square('e1'));
  expect(container.querySelectorAll('.square.legal')).toHaveLength(5);

  coordinates.set(false);
  legalDots.set(false);
  const off = renderBoard();
  off.unmount();
  const again = renderBoard();
  expect(again.container.querySelectorAll('.coordinate')).toHaveLength(0);
  fireEvent.click(again.square('e1'));
  expect(again.container.querySelectorAll('.square.legal')).toHaveLength(0);
});

test('with dragging off, pieces cannot be picked up by dragging', () => {
  dragPieces.set(false);
  const { square } = renderBoard();
  expect(square('e1')).toHaveAttribute('draggable', 'false');
});

test('auto-queen promotes without asking', () => {
  autoQueen.set(true);
  const { square, onMove } = renderBoard();
  fireEvent.click(square('e7'));
  fireEvent.click(square('e8'));
  expect(onMove).toHaveBeenCalledWith('e7e8q');
});

test('typed moves play on Enter, and a wrong one is refused', () => {
  typedMoves.set(true);
  const { onMove } = renderBoard();
  const box = screen.getByRole('textbox', { name: 'Type a move' });
  fireEvent.change(box, { target: { value: 'Ke9' } });
  fireEvent.submit(box);
  expect(screen.getByRole('alert')).toHaveTextContent('not a legal move');
  expect(onMove).not.toHaveBeenCalled();
  fireEvent.change(box, { target: { value: 'e8=R' } });
  fireEvent.submit(box);
  expect(onMove).toHaveBeenCalledWith('e7e8r');
});

test('a screen reader hears the last move when announcements are on', () => {
  announceMoves.set(true);
  const { container } = renderBoard('e2e7');
  expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(/pawn.*e7, from e2/i);
});
