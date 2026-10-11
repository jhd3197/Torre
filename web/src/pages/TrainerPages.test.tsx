import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { fakeServer, renderAt, START } from '../test/harness';
import type { GameDetail } from '../types';

const SLOW = { timeout: 10000 };
// The walkthrough replays the game before the first stop, which is slow under a full-suite load.
vi.setConfig({ testTimeout: 20000 });

const WALK = {
  id: 1, initialFen: START, user_color: 'white', opponent: 'Duke-BOT', date: '2026.09.05', progress: null,
  moves: [{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }, { uci: 'd2d4', san: 'd4' }, { uci: 'e5d4', san: 'exd4' }],
  mistakes: [{ ply: 3, move_number: 2, class: 'mistake', played: 'd2d4', played_san: 'd4', fen: 'x', best: 'g1f3', best_san: 'Nf3' }],
};

async function move(from: string, to: string) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: from })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: to })); });
}

test('the walkthrough replays to an error and accepts a better move', async () => {
  const server = fakeServer();
  server.on('api/trainer/mistakes/1', () => WALK);
  server.on('api/judge', () => ({ verdict: 'good', loss: 0, cp: 40, expected_cp: 40, line: ['Nf3', 'Nc6'], uci: ['g1f3', 'b8c6'] }));
  server.on('api/trainer/mistakes/result', body => ({ best: body?.found, total: body?.total, runs: 1 }));
  renderAt('/train/mistakes/1');
  expect(await screen.findByText(/Find a better move/, undefined, SLOW)).toHaveTextContent('You played d4 here, a mistake.');
  await move('White knight on g1', 'Empty f3');
  expect(await screen.findByText(/The engine’s choice/, undefined, SLOW)).toHaveTextContent('✓ Nf3');
  expect(server.calls.find(c => c.path === 'api/judge')?.body).toMatchObject({ moves: ['e2e4', 'e7e5'], move: 'g1f3', expected: 'g1f3' });
  fireEvent.click(screen.getByRole('button', { name: 'See summary' }));
  expect(await screen.findByText('You found 1 of 1.')).toBeInTheDocument();
  await waitFor(() => expect(server.calls.find(c => c.path === 'api/trainer/mistakes/result')?.body).toEqual({ gameId: 1, found: 1, total: 1 }));
  expect(await screen.findByText('Your best: 1 of 1 (1 runs).')).toBeInTheDocument();
});

test('repeating the game move is a miss; the answer and engine line are revealed', async () => {
  const server = fakeServer();
  server.on('api/trainer/mistakes/1', () => WALK);
  server.on('api/trainer/mistakes/result', body => ({ best: body?.found, total: body?.total, runs: 1 }));
  renderAt('/train/mistakes/1');
  await screen.findByText(/Find a better move/, undefined, SLOW);
  await move('White pawn on d2', 'Empty d4');
  expect(await screen.findByText(/is the move you played/)).toBeInTheDocument();
  expect(screen.getByText(/The answer was/)).toHaveTextContent('Nf3');
  expect(await screen.findByText('Engine line: e4 e5')).toBeInTheDocument();
  expect(server.calls.some(c => c.path === 'api/judge')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByText(/Find a better move/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show the answer' }));
  fireEvent.click(await screen.findByRole('button', { name: 'See summary' }));
  expect(await screen.findByText('You found 0 of 1.')).toBeInTheDocument();
});

test('a game without errors says so', async () => {
  const server = fakeServer();
  server.on('api/trainer/mistakes/1', () => ({ ...WALK, mistakes: [] }));
  renderAt('/train/mistakes/1');
  expect(await screen.findByText(/No mistakes or blunders/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to the game' })).toHaveAttribute('href', '/games/1');
});

test('an analyzed game with errors links to the walkthrough', async () => {
  const server = fakeServer();
  const detail: GameDetail = {
    initialFen: START, moves: WALK.moves, headers: { White: 'me', Black: 'Duke-BOT', Result: '0-1' },
    record: { id: 77, user_color: 'white', opponent: 'Duke-BOT' },
    analysis: { id: 77, scoring_version: 3, moves: [{ ply: 3, san: 'd4', class: 'mistake', best: false, brilliant: false, accuracy: 40 }], worst_moves: [] },
  } as unknown as GameDetail;
  server.on('api/games/77', () => detail);
  renderAt('/games/77');
  fireEvent.click(await screen.findByRole('button', { name: 'More' }));
  expect(await screen.findByRole('menuitem', { name: 'Learn from mistakes' })).toHaveAttribute('href', '/train/mistakes/77');
});

const MASTER_GAME = {
  index: 0, master: 'Testmaster', name: 'Ann Tester', side: 'white', initialFen: START, white: 'Ann Tester', black: 'Bob Other',
  year: 1990, result: '1-0', event: 'Training', progress: null,
  moves: [{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }, { uci: 'g1f3', san: 'Nf3' }],
};

test('guess the move scores each guess, pauses on a critical moment and saves the score', async () => {
  const server = fakeServer();
  server.on('api/trainer/masters/Testmaster/0', () => MASTER_GAME);
  server.on('api/trainer/guess', body => body?.move === body?.expected
    ? { exact: true, critical: false, san: 'e4', master: 'e2e4', master_san: 'e4', best: 'e2e4', best_san: 'e4', points: 10, loss: 0 }
    : { exact: false, critical: true, san: 'd4', master: 'g1f3', master_san: 'Nf3', best: 'g1f3', best_san: 'Nf3', points: 3, loss: 160 });
  server.on('api/trainer/masters/result', body => ({ best: body?.score, runs: 1, improved: true }));
  renderAt('/train/guess/Testmaster/0');
  fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
  expect(await screen.findByText(/What did Ann Tester play here/)).toBeInTheDocument();
  await move('White pawn on e2', 'Empty e4');
  expect(await screen.findByText(/Exactly what was played/)).toHaveTextContent('+10');
  expect(server.calls.find(c => c.path === 'api/trainer/guess')?.body).toMatchObject({ moves: [], move: 'e2e4', expected: 'e2e4' });
  // Black's reply plays itself, then it is White's turn again.
  await waitFor(() => expect(screen.getByRole('button', { name: 'White pawn on d2' })).toBeInTheDocument(), SLOW);
  await screen.findByText(/What did Ann Tester play here/, undefined, SLOW);
  await move('White pawn on d2', 'Empty d4');
  expect(await screen.findByText(/Critical moment/)).toHaveTextContent('Nf3 was the only good move here.');
  expect(screen.getByText(/Ann Tester played/)).toHaveTextContent('Your d4 is 160 cp worse. +3');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByText('You scored 13 of 20 (65%).')).toBeInTheDocument();
  await waitFor(() => expect(server.calls.find(c => c.path === 'api/trainer/masters/result')?.body)
    .toEqual({ masterId: 'Testmaster', index: 0, score: 13, max: 20 }));
  expect(await screen.findByText('A new best for this game!')).toBeInTheDocument();
});

test('legends list their games, searchable, with best scores', async () => {
  const server = fakeServer();
  server.on('api/masters', () => ({ masters: [{ id: 'Testmaster', name: 'Ann Tester', games: 2, wins: 1, draws: 0, losses: 1, peak: null, elo: 2500, rated: false, years: null }], missing: [] }));
  server.on('api/trainer/masters/Testmaster', () => ({ master: { id: 'Testmaster', name: 'Ann Tester' }, games: [
    { index: 0, white: 'Ann Tester', black: 'Bob Other', side: 'white', year: 1990, result: '1-0', event: 'Training', moves: 30, best: 42 },
    { index: 1, white: 'Cy Third', black: 'Ann Tester', side: 'black', year: 1991, result: '0-1', event: 'Open', moves: 20, best: null },
  ] }));
  renderAt('/train/guess');
  fireEvent.click(await screen.findByRole('link', { name: /Ann Tester/ }));
  expect(await screen.findByRole('link', { name: /Ann Tester – Bob Other/ })).toHaveTextContent('Best 42');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search games' }), { target: { value: 'third' } });
  expect(screen.queryByRole('link', { name: /Bob Other/ })).toBeNull();
  expect(screen.getByRole('link', { name: /Cy Third – Ann Tester/ })).toHaveAttribute('href', '/train/guess/Testmaster/1');
});
