// /arena — seating players, starting a match, watching it, and legends in the lobby and Play.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { loadPlay, savePlay } from '../lib/storage';
import { boardAfter, fakeServer, renderAt, START } from '../test/harness';
import type { MasterInfo } from '../types';

const CARLSEN: MasterInfo = {
  id: 'Carlsen', name: 'Magnus Carlsen', games: 7817, wins: 4000, draws: 2800, losses: 1017,
  peak: 2882, elo: 2882, rated: true, years: [2001, 2026],
};

const PLAYERS = [
  { name: 'Magnus Carlsen', engineId: 'stockfish', modelId: null, masterId: 'Carlsen', elo: 2882, engine: 'Stockfish', rating: 2882 },
  { name: 'Stockfish 2500', engineId: 'stockfish', modelId: null, masterId: null, elo: 2500, engine: 'Stockfish', rating: 2500 },
];

function liveMatch() {
  return {
    id: 'm1', date: '2026-10-05 21:00', players: PLAYERS, phase: 'playing',
    settings: { games: 2, movetime: 0.3, openings: 'start', pace: 'watch' },
    score: [1, 0],
    games: [{ number: 1, white: 0, result: '1-0', termination: 'checkmate', opening: null, plies: 41, moves: ['e2e4', 'e7e5'], book: [9, 0] }],
    current: {
      number: 2, white: 1, opening: null, moves: [{ uci: 'e2e4', san: 'e4' }, { uci: 'c7c5', san: 'c5' }],
      notes: [{ eval: { cp: 30, mate: null } }, { book: { count: 666, total: 1855, game: { opponent: 'Viswanathan Anand', year: 2014, result: '1-0', event: 'WCh' } } }],
      board: boardAfter(['e2e4', 'c7c5']), lastMove: 'c7c5', evals: [null, { cp: 30, mate: null }], judge: { cp: 100, mate: null },
    },
    error: null, stopped: false,
  };
}

function serveArena() {
  const server = fakeServer();
  server.on('api/masters', () => ({ masters: [CARLSEN], missing: [{ id: 'Tal', name: 'Mikhail Tal' }] }));
  let running = false;
  server.on('api/arena', () => running
    ? { running: true, match: liveMatch(), recent: [] }
    : { running: false, match: null, recent: [] });
  server.on('api/arena/start', () => { running = true; return { running: true, match: liveMatch(), recent: [] }; });
  return server;
}

/** Who sits in a seat card ("Player 1" or "Player 2"). */
const seat = (setup: HTMLElement, name: string) => within(within(setup).getByRole('region', { name }));

test('the rail opens the Arena, and its old address still leads there', async () => {
  fakeServer();
  const { location } = renderAt('/engines/arena');
  await waitFor(() => expect(location().pathname).toBe('/arena'));
  const nav = screen.getByRole('navigation', { name: 'Studio sections' });
  expect(within(nav).getByRole('link', { name: 'Arena' })).toHaveAttribute('href', '/arena');
  expect(screen.getByRole('link', { name: 'Engines' })).toHaveAttribute('href', '/settings/engines');
});

test('historical five-grade totals do not invent zeroes for new categories', async () => {
  const match = { ...liveMatch(), current: null, phase: 'finished',
    grades: [{ brilliant: 1, best: 4, inaccuracy: 2, mistake: 0, blunder: 0 },
             { brilliant: 0, best: 3, inaccuracy: 1, mistake: 0, blunder: 0 }] };
  fakeServer().on('api/arena', () => ({ running: false, match, recent: [] }));
  renderAt('/arena');
  await screen.findByRole('button', { name: 'Rematch' });
  for (const grade of ['great', 'good', 'book']) {
    const cells = document.querySelectorAll(`.arena-tally .move-${grade} td`);
    expect([...cells].map(c => c.textContent)).toEqual(['–', '–']);
  }
});

test('a legend is seated against Stockfish by default and the match starts with both specs', async () => {
  const server = serveArena();
  renderAt('/arena');
  const setup = await screen.findByRole('region', { name: 'Match setup' });
  await waitFor(() => expect(seat(setup, 'Player 1').getByText('Magnus Carlsen')).toBeInTheDocument());
  expect(seat(setup, 'Player 2').getByText('Stockfish')).toBeInTheDocument();
  expect(seat(setup, 'Player 1').getByText(/Opens with the moves from their 7,817 games, then Stockfish plays at 2882/)).toBeInTheDocument();
  fireEvent.change(within(setup).getByLabelText('Strength'), { target: { value: '2500' } });
  // The ratings predict the score: 2882 against 2500 over two games.
  expect(within(setup).getByLabelText('Expected score: Magnus Carlsen 1.8, Stockfish 0.2')).toBeInTheDocument();
  expect(within(setup).getByText('Magnus Carlsen is rated 382 points higher')).toBeInTheDocument();
  fireEvent.click(within(setup).getByRole('button', { name: '4' }));
  fireEvent.click(within(setup).getByRole('button', { name: 'Start match' }));
  await waitFor(() => expect(server.calls.find(c => c.path === 'api/arena/start')?.body).toEqual({
    players: [{ masterId: 'Carlsen' }, { engineId: 'stockfish', elo: 2500 }],
    games: 4, movetime: 0.3, openings: 'start', pace: 'watch',
  }));
  // The live match: score, the legend's book move explained, and the finished game's replay link.
  expect(await screen.findByText('Game 2 of 2')).toBeInTheDocument();
  expect(screen.getByLabelText('Match score')).toHaveTextContent('Magnus Carlsen1–0Stockfish 2500');
  expect(screen.getByText(/Magnus Carlsen played this in 666 of 1855 of their games from here, one of them against Viswanathan Anand \(2014\)/)).toBeInTheDocument();
  expect(screen.getByText('9 moves from their games', { exact: false })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Replay' })).toHaveAttribute('href', '/explore?moves=e2e4%2Ce7e5&from=%2Farena');
  expect(screen.getByRole('button', { name: 'Stop match' })).toBeInTheDocument();
  // The judge says White (Stockfish 2500 this game) is a pawn up: 64% for it, shown on Player 2's side.
  expect(screen.getByRole('img', { name: 'Magnus Carlsen 36% · Stockfish 2500 64%' })).toBeInTheDocument();
  expect(document.querySelector('#eval-value')).toHaveTextContent('+1.0');
});

test('AI models take a seat with a help level and an effort, under a spending cap, and say why they moved', async () => {
  const server = serveArena();
  const fable = { name: 'claude-fable-5-1', engineId: null, modelId: null, masterId: null, elo: null, engine: 'claude/claude-fable-5-1', rating: null,
    ai: { model: 'claude/claude-fable-5-1', level: 0, effort: 'high' } };
  server.on('api/arena/start', () => ({ running: true, recent: [], match: { ...liveMatch(), players: [fable, PLAYERS[1]], cost: [0.42, 0],
    current: { ...liveMatch().current, white: 0, notes: [{ ai: { reason: 'Center first.', tries: 1, rescued: false, cost: 0.42, tokens: 900, seconds: 31.5 } }] } } }));
  renderAt('/arena');
  const setup = await screen.findByRole('region', { name: 'Match setup' });
  await waitFor(() => expect(seat(setup, 'Player 1').getByText('Magnus Carlsen')).toBeInTheDocument());
  fireEvent.click(seat(setup, 'Player 1').getByRole('button', { name: 'Change player' }));
  fireEvent.click(await screen.findByRole('button', { name: /claude-fable-5-1/ }));
  expect(seat(setup, 'Player 1').getByText('AI model')).toBeInTheDocument();
  fireEvent.change(seat(setup, 'Player 1').getByLabelText('Help'), { target: { value: '1' } });
  // An AI at the board brings the spending cap; $20 unless changed.
  fireEvent.click(within(setup).getByRole('button', { name: '$5' }));
  fireEvent.click(within(setup).getByRole('button', { name: 'Start match' }));
  await waitFor(() => expect(server.calls.find(c => c.path === 'api/arena/start')?.body).toEqual({
    players: [{ ai: { model: 'claude/claude-fable-5-1', level: 1, effort: 'high' } }, { engineId: 'stockfish', elo: 2500 }],
    games: 2, movetime: 0.3, openings: 'start', pace: 'watch', costCap: 5,
  }));
  expect(await screen.findByText('“Center first.”', { exact: false })).toBeInTheDocument();
  expect(screen.getByText('Spent: claude-fable-5-1 $0.420 · Stockfish 2500 $0.000')).toBeInTheDocument();
});

test('missing champions can be downloaded as legends', async () => {
  const server = serveArena();
  server.on('api/masters/download', () => ({ masters: [CARLSEN, { ...CARLSEN, id: 'Tal', name: 'Mikhail Tal', peak: 2705, elo: 2705 }], missing: [] }));
  renderAt('/arena');
  fireEvent.click(await screen.findByText('Add 1 more legend'));
  fireEvent.click(screen.getByRole('button', { name: 'Mikhail Tal' }));
  await waitFor(() => expect(server.calls.find(c => c.path === 'api/masters/download')?.body).toEqual({ id: 'Tal' }));
  // Tal can now take a seat.
  const setup = screen.getByRole('region', { name: 'Match setup' });
  fireEvent.click(seat(setup, 'Player 1').getByRole('button', { name: 'Change player' }));
  expect(await screen.findByRole('button', { name: /Mikhail Tal/ })).toBeInTheDocument();
});

test('a legend bot in the lobby starts a game that asks for its book moves', async () => {
  const server = fakeServer();
  server.on('api/masters', () => ({ masters: [CARLSEN], missing: [] }));
  server.on('api/masters/prepare', () => ({ master: { ...CARLSEN, openings: { white: [['e4', 44], ['d4', 30]], black: {} }, positions: 109248 } }));
  server.on('api/move', body => ({ san: String(body?.move) === 'e2e4' ? 'e4' : 'c5', uci: body?.move, result: null }));
  server.on('api/engine', () => ({ best: 'c7c5', lines: [], book: { count: 666, total: 1855, game: { opponent: 'Viswanathan Anand', year: 2014, result: '1-0', event: 'WCh' } } }));
  const { location } = renderAt('/play/bots/legends');
  fireEvent.click((await screen.findByText('Magnus Carlsen', { selector: '.bot-card strong' })).closest('button')!);
  expect(await screen.findByText('1.e4 44% · 1.d4 30%')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Black', { selector: 'button' }));
  fireEvent.click(screen.getByText(/Start game/, { selector: 'button' }));
  await waitFor(() => expect(location().pathname).toBe('/play'));
  expect(loadPlay()).toMatchObject({ botId: 'legend-Carlsen', masterId: 'Carlsen', elo: 2882, playerColor: 'black' });
  savePlay({ ...loadPlay()!, playerColor: 'white', moves: [{ uci: 'e2e4', san: 'e4' }], initialFen: START });
  renderAt('/play');
  await waitFor(() => expect(server.calls.find(c => c.path === 'api/engine')?.body).toMatchObject({ play: true, masterId: 'Carlsen', elo: 2882 }));
  expect(await screen.findAllByText(/played this in 666 of 1855/)).not.toHaveLength(0);
}, 15000);

test('the lobby shows legends as cards in their era, and a missing one can fetch its games', async () => {
  const server = fakeServer();
  const tal = { ...CARLSEN, id: 'Tal', name: 'Mikhail Tal', peak: 2705, elo: 2705, years: [1949, 1992] as [number, number] };
  server.on('api/masters', () => ({ masters: [CARLSEN], missing: [{ id: 'Tal', name: 'Mikhail Tal' }] }));
  server.on('api/masters/download', () => ({ masters: [CARLSEN, tal], missing: [] }));
  server.on('api/masters/prepare', () => ({ master: { ...CARLSEN, openings: { white: [['e4', 44]], black: {} }, positions: 1 } }));
  renderAt('/play/bots/legends');
  const modern = await screen.findByRole('region', { name: 'The Modern era' });
  const carlsen = within(modern).getByText('Magnus Carlsen').closest('button')!;
  expect(carlsen.querySelector('img')).toHaveAttribute('src', 'art/legends/Carlsen.webp');
  // Tal has no games yet: he waits in the Cold War row until they are fetched.
  const coldWar = screen.getByRole('region', { name: 'The Cold War' });
  fireEvent.click(within(coldWar).getByRole('button', { name: 'Get their games' }));
  await waitFor(() => expect(server.calls.find(c => c.path === 'api/masters/download')?.body).toEqual({ id: 'Tal' }));
  fireEvent.click((await within(coldWar).findByText('Mikhail Tal', { selector: '.bot-card strong' })).closest('button')!);
  expect(await screen.findByAltText('Mikhail Tal')).toHaveAttribute('src', 'art/legends/Tal.webp');
});

test('a seat changes player from the picker of figures', async () => {
  const server = serveArena();
  server.on('api/masters', () => ({ masters: [CARLSEN, { ...CARLSEN, id: 'Tal', name: 'Mikhail Tal', peak: 2705, elo: 2705 }], missing: [] }));
  renderAt('/arena');
  const setup = await screen.findByRole('region', { name: 'Match setup' });
  await waitFor(() => expect(seat(setup, 'Player 2').getByText('Stockfish')).toBeInTheDocument());
  fireEvent.click(seat(setup, 'Player 2').getByRole('button', { name: 'Change player' }));
  const picker = screen.getByRole('group', { name: 'Players for Player 2' });
  expect(within(picker).getByRole('button', { name: /Stockfish/ })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(within(picker).getByRole('button', { name: /Mikhail Tal/ }));
  expect(screen.queryByRole('group', { name: 'Players for Player 2' })).toBeNull();
  expect(seat(setup, 'Player 2').getByText('Mikhail Tal')).toBeInTheDocument();
  expect(seat(setup, 'Player 2').queryByLabelText('Strength')).toBeNull();
  expect(server.calls.some(c => c.path === 'api/arena/start')).toBe(false);
});

test('a match can stop early by SPRT from book openings, and the ladder ranks every player', async () => {
  const server = serveArena();
  const finished = {
    ...liveMatch(), phase: 'done', current: null, score: [7, 0], early: true,
    games: [{ number: 1, white: 0, result: '1-0', termination: 'checkmate', opening: '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6', eco: 'C84', openingName: 'Ruy Lopez', plies: 41, moves: ['e2e4'], book: [0, 0] }],
    sprt: { llr: 3.01, lower: -2.94, upper: 2.94, elo0: 0, elo1: 50, verdict: 'H1' },
  };
  server.on('api/arena/start', () => ({ running: false, match: finished, recent: [] }));
  server.on('api/arena/ladder', () => ({
    groups: 1, games: 7, anchor: null,
    players: [
      { id: 'master:Carlsen@2882', name: 'Magnus Carlsen', nominal: null, rating: 2780, ci_low: 2600, ci_high: 2960, games: 7, points: 7, score: 100, wins: 7, draws: 0, losses: 0, group: 0, placed_by: 'average' },
      { id: 'engine:stockfish@2500', name: 'Stockfish 2500', nominal: 2500, rating: 2500, ci_low: 2500, ci_high: 2500, games: 7, points: 0, score: 0, wins: 0, draws: 0, losses: 7, group: 0, placed_by: 'nominal' },
    ],
  }));
  renderAt('/arena');
  const setup = await screen.findByRole('region', { name: 'Match setup' });
  await waitFor(() => expect(seat(setup, 'Player 1').getByText('Magnus Carlsen')).toBeInTheDocument());
  fireEvent.click(within(setup).getByRole('button', { name: 'Book openings' }));
  fireEvent.click(within(setup).getByRole('button', { name: 'When decided' }));
  fireEvent.click(within(setup).getByRole('button', { name: '100' }));
  expect(within(setup).getByText(/statistically clear/)).toBeInTheDocument();
  fireEvent.click(within(setup).getByRole('button', { name: 'Start match' }));
  await waitFor(() => expect(server.calls.find(c => c.path === 'api/arena/start')?.body).toMatchObject({ games: 100, openings: 'book', sprt: true }));
  expect(await screen.findByText(/SPRT: Magnus Carlsen is stronger \(LLR 3.01\)/)).toBeInTheDocument();
  expect(screen.getByText(/Ruy Lopez \(C84\)/)).toBeInTheDocument();
  // The result screen names the winner and offers a rematch or a new match.
  expect(screen.getByRole('heading', { name: 'Magnus Carlsen wins' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Rematch' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'New match' }));
  expect(screen.getByRole('region', { name: 'Match setup' })).toBeInTheDocument();
  const ladder = await screen.findByRole('region', { name: 'Ladder' });
  expect(within(ladder).getByText('2780')).toBeInTheDocument();
  expect(within(ladder).getByText(/95% range 2600–2960/)).toBeInTheDocument();
  expect(within(ladder).getByText(/set at 2500/)).toBeInTheDocument();
});
