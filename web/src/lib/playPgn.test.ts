import { playPgn } from './playPgn';
import { START_FEN } from './format';

test('a bot game becomes PGN with your name on your side and the result', () => {
  const pgn = playPgn({ initialFen: START_FEN, moves: [{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }, { uci: 'd1h5', san: 'Qh5' }],
    playerColor: 'black', level: 4, result: '1-0' }, 'me', 'Granny Rose', new Date(2026, 9, 10));
  expect(pgn).toContain('[White "Granny Rose"]');
  expect(pgn).toContain('[Black "me"]');
  expect(pgn).toContain('[Date "2026.10.10"]');
  expect(pgn).not.toContain('[FEN');
  expect(pgn.trim().split('\n').at(-1)).toBe('1. e4 e5 2. Qh5 1-0');
});

test('a game from a position carries its FEN and numbers Black-first moves', () => {
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
  const pgn = playPgn({ initialFen: fen, moves: [{ uci: 'g8f6', san: 'Nf6' }, { uci: 'f3f7', san: 'Qxf7#' }],
    playerColor: 'black', level: 4, result: null }, 'me', 'Bot');
  expect(pgn).toContain(`[FEN "${fen}"]`);
  expect(pgn.trim().split('\n').at(-1)).toBe('3... Nf6 4. Qxf7# *');
});
