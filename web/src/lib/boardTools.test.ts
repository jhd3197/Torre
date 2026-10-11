import { arrowPath, castleMove, center, heat, isCastleGesture, plan, toggleMark } from './boardTools';

const board = {
  pieces: { e1: 'K', a1: 'R', h1: 'R', e8: 'k', a8: 'r', h8: 'r' } as Record<string, string>,
  legal: ['e1g1', 'e1c1', 'e8g8', 'e8c8'],
};

test('both pieces can initiate castling on either side for either color', () => {
  for (const rank of ['1', '8']) {
    expect(castleMove(board, 'e' + rank, 'h' + rank)).toBe('e' + rank + 'g' + rank);
    expect(castleMove(board, 'h' + rank, 'e' + rank)).toBe('e' + rank + 'g' + rank);
    expect(castleMove(board, 'e' + rank, 'a' + rank)).toBe('e' + rank + 'c' + rank);
    expect(castleMove(board, 'a' + rank, 'e' + rank)).toBe('e' + rank + 'c' + rank);
  }
});

test('shortcuts cannot bypass the engine legal-move list', () => {
  for (const legal of [[], ['e1f1'], ['h1g1']]) {
    expect(castleMove({ ...board, legal }, 'h1', 'e1')).toBeNull();
    expect(castleMove({ ...board, legal }, 'e1', 'a1')).toBeNull();
  }
  expect(castleMove(board, 'e1', 'h8')).toBeNull();
  expect(castleMove(board, 'h1', 'a1')).toBeNull();
  expect(isCastleGesture(board, 'h1', 'e1')).toBe(true);
  expect(isCastleGesture(board, 'h1', 'e8')).toBe(false);
});

test('drawings toggle individually and preserve other arrows and circles', () => {
  const first = toggleMark([], 'e2', 'e4');
  const second = toggleMark(first, 'g1', 'f3');
  const circle = toggleMark(second, 'e4', 'e4');
  expect(circle).toHaveLength(3);
  expect(toggleMark(circle, 'e2', 'e4')).toEqual([{ from: 'g1', to: 'f3' }, { from: 'e4', to: 'e4' }]);
  expect(first).toHaveLength(1);
});

test('drawing endpoints rotate with board orientation', () => {
  expect(center('a8', false)).toEqual({ x: 50, y: 50 });
  expect(center('a8', true)).toEqual({ x: 750, y: 750 });
  expect(center('e2', false)).toEqual({ x: 450, y: 650 });
  expect(center('e2', true)).toEqual({ x: 350, y: 150 });
});

test('knight arrows bend at a right angle along the long leg first, including when flipped', () => {
  const b = { pieces: { g1: 'N', c3: 'n' } as Record<string, string> };
  expect(arrowPath(b, 'g1', 'f3')).toBe('M650,750 L650,550 L550,550');
  expect(arrowPath(b, 'g1', 'f3', true)).toBe('M150,50 L150,250 L250,250');
  expect(arrowPath(b, 'c3', 'e4')).toBe('M250,550 L450,550 L450,450');
  expect(arrowPath({ pieces: { a7: 'Q' } }, 'a7', 'g7')).toBe('M50,150 L650,150');
});

test('a trimmed arrow stops short of the target along its last leg, leaving room for the head', () => {
  expect(arrowPath({ pieces: { a7: 'Q' } }, 'a7', 'g7', false, 28)).toBe('M50,150 L622,150');
  expect(arrowPath({ pieces: { g1: 'N' } }, 'g1', 'f3', false, 28)).toBe('M650,750 L650,550 L578,550');
});

test('planning uses legal destinations; freeform only relaxes drawing from empty squares', () => {
  const b = { pieces: { a7: 'Q' } as Record<string, string>, plans: { a7: ['b7', 'a6'] }, legal: [] };
  expect(plan(b, 'a7', 'b7').allowed).toBe(true);
  expect(plan(b, 'a7', 'b5').allowed).toBe(false);
  expect(plan(b, 'a7', 'b5', true).allowed).toBe(false);
  expect(plan(b, 'c3', 'e4').allowed).toBe(false);
  expect(plan(b, 'c3', 'e4', true)).toEqual({ allowed: true, kind: 'note' });
  expect(plan(b, 'c3', 'c3').allowed).toBe(true);
});

test('heat map distinguishes control, contested squares, and no attacks', () => {
  expect(heat({ white: ['e2'], black: [] }).kind).toBe('white');
  expect(heat({ white: [], black: ['d5'] }).kind).toBe('black');
  expect(heat({ white: ['e2'], black: ['d5'] }).kind).toBe('contested');
  expect(heat({ white: [], black: [] }).kind).toBe('neutral');
});
