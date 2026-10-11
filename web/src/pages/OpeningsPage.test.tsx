import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { fakeServer, renderAt, START, playMove } from '../test/harness';
import { numbered, type OpeningAnswer, type OpeningDeck } from './OpeningsPage';

const deck = (extra: Partial<OpeningDeck> = {}): OpeningDeck => ({
  total: 12, learned: 3, due: 1, new: 4, new_total: 9, new_per_day: 10, next_due: null, colors: { white: 7, black: 5 },
  card: { id: 'white:start', source: 'games', color: 'white', fen: START, line: [], seen: 42, opening: "Queen's Pawn Game" },
  lines: [], ...extra,
});

const answer = (extra: Partial<OpeningAnswer> = {}): OpeningAnswer => ({
  correct: false, san: 'e4', best: 'd2d4', best_san: 'd4', source: 'games', seen: 42,
  played: [{ san: 'd4', count: 30 }, { san: 'e4', count: 12 }], corrected: false, reviewed: true,
  next_review: new Date(Date.now() + 60_000).toISOString(), next: deck({ card: null, next_due: new Date(Date.now() + 3_600_000).toISOString() }),
  ...extra,
});

const move = (from: string, to: string) => playMove(new RegExp(`on ${from}$`), new RegExp(`${to}$`));

test('numbered lines', () => {
  expect(numbered(['e4', 'e5', 'Nf3'])).toBe('1. e4 e5 2. Nf3');
  expect(numbered([])).toBe('');
});

describe('Openings', () => {
  test('a repertoire card is answered on the board, and a miss shows your move', async () => {
    const server = fakeServer();
    server.on('api/openings', () => deck());
    server.on('api/openings/answer', () => answer());
    renderAt('/openings');
    expect(await screen.findByText(/Starting position · Queen's Pawn Game/)).toBeInTheDocument();
    expect(screen.getByText(/You reached this position in 42 games/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mistake drills' })).toHaveAttribute('href', '/train');
    await move('e2', 'e4');
    await waitFor(() => expect(server.calls.find(c => c.path === 'api/openings/answer')?.body).toEqual({ id: 'white:start', move: 'e2e4' }));
    expect(await screen.findByText(/is not your repertoire move/)).toBeInTheDocument();
    expect(screen.getByText(/In your games: d4 ×30, e4 ×12/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next position' })); });
    expect(screen.getByRole('heading', { name: 'Repertoire reviewed' })).toBeInTheDocument();
  }, 15000); // plays a move on the board, which runs close to the 5 s default under a full-suite load

  test('your own lines are added and removed', async () => {
    const server = fakeServer();
    const line = { id: 'abc', color: 'black' as const, text: '1. d4 Nf6', added: '2026-10-03' };
    server.on('api/openings', () => deck({ card: null, total: 0 }));
    server.on('api/openings/lines', () => ({ line, next: deck({ card: null, lines: [line] }) }));
    server.on('api/openings/lines/delete', () => ({ next: deck({ card: null, lines: [] }) }));
    renderAt('/openings');
    expect(await screen.findByRole('heading', { name: 'No repertoire yet' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Play the line as' }), { target: { value: 'black' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Moves' }), { target: { value: '1. d4 Nf6' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add line' })); });
    expect(server.calls.find(c => c.path === 'api/openings/lines')?.body).toEqual({ color: 'black', line: '1. d4 Nf6' });
    expect(await screen.findByText(/Black: 1. d4 Nf6/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove 1. d4 Nf6' })); });
    await waitFor(() => expect(screen.queryByText(/Black: 1. d4 Nf6/)).not.toBeInTheDocument());
  });
});
