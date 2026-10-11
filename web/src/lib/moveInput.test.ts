import { typedMove } from './moveInput';
import type { BoardState } from '../types';

// After 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5, White to move: knights on b1 and f3 can both reach d2.
const POSITION: Pick<BoardState, 'pieces' | 'legal' | 'turn'> = {
  turn: 'white',
  pieces: { e1: 'K', h1: 'R', a1: 'R', b1: 'N', f3: 'N', c4: 'B', e4: 'P', d2: 'P', e5: 'p', c5: 'b', d1: 'Q', g2: 'P' },
  legal: ['e1g1', 'f3e5', 'b1c3', 'b1a3', 'f3d4', 'f3h4', 'f3g5', 'f3g1', 'c4f7', 'd2d4', 'd2d3', 'g2g3', 'g2g4', 'd1e2'],
};

test('SAN, UCI and castling name the legal move', () => {
  const said = (text: string) => typedMove(POSITION, text);
  expect(said('Nxe5')).toBe('f3e5');
  expect(said('nxe5')).toBe('f3e5');
  expect(said('Bxf7+')).toBe('c4f7');
  expect(said('d4')).toBe('d2d4');
  expect(said('g2g4')).toBe('g2g4');
  expect(said('O-O')).toBe('e1g1');
  expect(said('0-0')).toBe('e1g1');
  expect(said('Qe2')).toBe('d1e2');
});

test('nothing plays for a move that is illegal, unclear or not a move', () => {
  const said = (text: string) => typedMove(POSITION, text);
  expect(said('O-O-O')).toBeNull();
  expect(said('Ke2')).toBeNull();
  expect(said('hello')).toBeNull();
  expect(said('')).toBeNull();
  // Both knights reach d2 here: only a file or rank settles which.
  const both = { ...POSITION, legal: ['b1d2', 'f3d2'] };
  expect(typedMove(both, 'Nd2')).toBeNull();
  expect(typedMove(both, 'Nbd2')).toBe('b1d2');
});

test('promotions take their piece, a queen when none is given', () => {
  const promoting = { turn: 'white' as const, pieces: { e7: 'P', e1: 'K', a8: 'k' }, legal: ['e7e8q', 'e7e8r', 'e7e8b', 'e7e8n'] };
  expect(typedMove(promoting, 'e8=N')).toBe('e7e8n');
  expect(typedMove(promoting, 'e8r')).toBe('e7e8r');
  expect(typedMove(promoting, 'e8')).toBe('e7e8q');
  expect(typedMove(promoting, 'e7e8')).toBe('e7e8q');
});

test('Spanish piece letters: C for the knight, D for the queen, R for the king', () => {
  expect(typedMove(POSITION, 'Cxe5', 'es')).toBe('f3e5');
  expect(typedMove(POSITION, 'De2', 'es')).toBe('d1e2');
  expect(typedMove(POSITION, 'Axf7', 'es')).toBe('c4f7');
  const promoting = { turn: 'white' as const, pieces: { e7: 'P', e1: 'K', a8: 'k' }, legal: ['e7e8q', 'e7e8r', 'e1d1'] };
  expect(typedMove(promoting, 'e8=T', 'es')).toBe('e7e8r');
  expect(typedMove(promoting, 'Rd1', 'es')).toBe('e1d1');
});
