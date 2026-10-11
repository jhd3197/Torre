import { START_FEN } from './format';
import { explorePath, gamePath, parseExplore } from './routes';

const parse = (path: string) => parseExplore(new URLSearchParams(path.split('?')[1] ?? ''));

test('game paths carry the move', () => {
  expect(gamePath(123)).toBe('/games/123');
  expect(gamePath(123, 0)).toBe('/games/123/0');
  expect(gamePath('imported', 7)).toBe('/games/imported/7');
});

test('an exploration round-trips through its URL', () => {
  const state = { fen: '8/8/8/8/8/8/k7/K7 b - - 0 1', moves: ['a2b3', 'a1b1'], base: 1, from: '/games/9/12', flipped: true };
  expect(parse(explorePath(state))).toEqual(state);
});

test('the starting position and empty values are left out of the URL', () => {
  expect(explorePath({})).toBe('/explore');
  expect(parse('/explore')).toEqual({ fen: START_FEN, moves: [], base: 0, from: null, flipped: false });
});

test('orientation defaults to the side to move but a chosen side wins', () => {
  const blackToMove = '8/8/8/8/8/8/k7/K7 b - - 0 1';
  expect(parse(explorePath({ fen: blackToMove })).flipped).toBe(true);
  expect(parse(explorePath({ fen: blackToMove, flipped: false })).flipped).toBe(false);
});

test('malformed parameters are ignored, and only in-app return paths are kept', () => {
  const state = parse('/explore?moves=e2e4,zz99,e7e5&base=99&from=https://example.com');
  expect(state.moves).toEqual(['e2e4', 'e7e5']);
  expect(state.base).toBe(2);
  expect(state.from).toBeNull();
});
