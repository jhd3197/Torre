import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { fakeServer, renderAt } from '../test/harness';
import type { BoardState } from '../types';
import type { Endgame, EndgameCatalog, EndgameMove } from './EndgamesPage';

const KQK = '8/8/8/4k3/8/8/8/4K2Q w - - 0 1';

const endgame = (extra: Partial<Endgame> = {}): Endgame => ({
  id: 'kqk', group: 'mates', goal: 'win', moves: 20, fen: KQK, color: 'white', title: 'Queen checkmate',
  explain: 'Box the king in with the queen.', attempts: 0, completed: null, best: null, ...extra,
});

const catalog = (): EndgameCatalog => ({
  positions: [
    endgame(),
    endgame({ id: 'philidor', group: 'rooks', goal: 'draw', moves: 25, color: 'black', title: 'Philidor position', attempts: 2, completed: '2026-10-03T12:00:00Z', best: 25 }),
  ],
  completed: 1, total: 2,
});

function board(pieces: Record<string, string>, turn: 'white' | 'black'): BoardState {
  return { fen: `${Object.keys(pieces).join('')} ${turn[0]} - - 0 1`, turn, pieces, check: null, result: null, termination: null,
    legal: turn === 'white' ? ['h1h5', 'h5h4', 'e1e2'] : ['e5e6'], plans: {}, control: {} };
}

async function move(from: string, to: string) {
  const piece = await screen.findByRole('button', { name: new RegExp(`on ${from}$`) }, { timeout: 3000 });
  await act(async () => { fireEvent.click(piece); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: new RegExp(`${to}$`) })); });
}

function serve(reply: Partial<EndgameMove>) {
  const server = fakeServer();
  server.on('api/endgames', () => catalog());
  server.on('api/position', body => {
    const moves = (body?.moves as string[]) ?? [];
    if (!moves.length) return board({ e1: 'K', h1: 'Q', e5: 'k' }, 'white');
    return board(moves.length === 1 ? { e1: 'K', h5: 'Q', e5: 'k' } : { e1: 'K', h5: 'Q', e6: 'k' }, moves.length === 1 ? 'black' : 'white');
  });
  server.on('api/endgames/move', () => ({ status: 'playing', reason: null, reply: 'e5e6', reply_san: 'Ke6', used: 1, progress: { attempts: 1 }, ...reply }));
  return server;
}

describe('Endgames', () => {
  test('the list groups positions and shows progress', async () => {
    serve({});
    renderAt('/endgames');
    expect(await screen.findByText('Classic endgames to play out against Stockfish. 1 of 2 completed.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Basic checkmates' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Queen checkmate.*White to play and win · within 20 moves.*Not tried yet/ })).toHaveAttribute('href', '/endgames/kqk');
    expect(screen.getByRole('link', { name: /Philidor position.*Black to play and draw · hold for 25 moves.*Completed in 25 moves/ })).toBeInTheDocument();
  });

  test('a move is sent to the server, the engine answers, and the result is shown', async () => {
    const server = serve({});
    renderAt('/endgames/kqk');
    expect(await screen.findByRole('heading', { name: 'Queen checkmate' })).toBeInTheDocument();
    expect(screen.getByText('20 moves left to win.')).toBeInTheDocument();
    await move('h1', 'h5');
    await waitFor(() => expect(server.calls.find(c => c.path === 'api/endgames/move')?.body).toEqual({ id: 'kqk', moves: ['h1h5'] }));
    expect(await screen.findByText('19 moves left to win.')).toBeInTheDocument();
    await screen.findByRole('button', { name: /king on e6$/ });

    server.on('api/endgames/move', () => ({ status: 'success', reason: 'mate', reply: null, reply_san: null, used: 2, progress: { attempts: 1, completed: 'now', best: 2 } }));
    await move('h5', 'h4');
    expect(await screen.findByText('✓ Checkmate! Done in 2 moves.')).toBeInTheDocument();
    expect(server.calls.filter(c => c.path === 'api/endgames/move').at(-1)?.body).toEqual({ id: 'kqk', moves: ['h1h5', 'e5e6', 'h5h4'] });
    expect(screen.getByRole('link', { name: 'Next endgame' })).toHaveAttribute('href', '/endgames/philidor');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(screen.getByText('20 moves left to win.')).toBeInTheDocument();
  });
});
