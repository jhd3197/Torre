import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { loadPlay, savePlay } from '../lib/storage';
import { boardAfter, engineEntry, fakeServer, renderAt, START, STOCKFISH } from '../test/harness';

// A collection lists its bots as cards; role queries across all of them are slow in jsdom.
const botCard = (name: HTMLElement) => name.closest('button')!;

function serveMoves() {
  const server = fakeServer();
  server.on('api/move', body => {
    const uci = String(body?.move);
    return { san: uci === 'e2e4' ? 'e4' : uci === 'e7e5' ? 'e5' : uci, uci, result: null };
  });
  return server;
}

test('/play without a saved game opens the bot lobby', async () => {
  fakeServer();
  const { location } = renderAt('/play');
  await waitFor(() => expect(location().pathname).toBe('/play/bots'));
  expect(await screen.findByRole('region', { name: 'Choose a chess bot' })).toBeInTheDocument();
});

test('starting a game from the lobby saves it and opens /play', async () => {
  fakeServer();
  const { location } = renderAt('/play/bots/engines');
  fireEvent.click(botCard(await screen.findByText('Stockfish 18', { selector: '.bot-card strong' })));
  fireEvent.click(screen.getByText('Black', { selector: 'button' }));
  fireEvent.click(screen.getByText(/Start game/, { selector: 'button' }));
  await waitFor(() => expect(location().pathname).toBe('/play'));
  expect(loadPlay()).toMatchObject({ moves: [], playerColor: 'black', level: 4, result: null });
  expect(loadPlay()?.botId).toBeUndefined();
});

test('before your first move you can leave the game, and it does not count', async () => {
  const server = serveMoves();
  savePlay({ initialFen: START, moves: [], playerColor: 'white', level: 4, result: null, botId: 'granny-rose', elo: 1200 });
  const { location } = renderAt('/play');
  const leave = await screen.findByRole('button', { name: 'Leave game' });
  expect(screen.queryByRole('button', { name: /Resign/ })).not.toBeInTheDocument();
  fireEvent.click(leave);
  await waitFor(() => expect(location().pathname).toBe('/play/bots'));
  expect(loadPlay()).toBeNull();
  expect(server.calls.some(c => c.path === 'api/played')).toBe(false);
});

test('a character bot is playable and plays at its rating', async () => {
  const server = serveMoves();
  server.on('api/engine', () => ({ best: 'e2e4', lines: [] }));
  const { location } = renderAt('/play/bots/always');
  fireEvent.click(botCard(await screen.findByText('Granny Rose', { selector: '.bot-card strong' })));
  fireEvent.click(screen.getByText('Black', { selector: 'button' }));
  fireEvent.click(screen.getByText(/Start game/, { selector: 'button' }));
  await waitFor(() => expect(location().pathname).toBe('/play'));
  expect(loadPlay()).toMatchObject({ botId: 'granny-rose', elo: 2600, playerColor: 'black' });
  expect(await screen.findByText('“Cookie before we start, dear?”')).toBeInTheDocument();
  await waitFor(() => expect(server.calls.find(c => c.path === 'api/engine')?.body).toMatchObject({ play: true, elo: 2600 }));
}, 15000);

test('preview bots cannot start a game', async () => {
  fakeServer();
  renderAt('/play/bots/yours');
  fireEvent.click(botCard(await screen.findByText('Present You', { selector: '.bot-card strong' })));
  expect(screen.getByRole('button', { name: 'Preview only' })).toBeDisabled();
});

test('an engine bot becomes playable when its engine is installed and plays with it', async () => {
  const server = serveMoves();
  server.on('api/engines', () => ({ engines: [STOCKFISH, engineEntry('lc0', 'Leela Chess Zero', { installed: true, type: 'neural' })] }));
  server.on('api/engine', () => ({ best: 'e2e4', lines: [] }));
  const { location } = renderAt('/play/bots/engines');
  fireEvent.click(botCard(await screen.findByText('Leela Zero', { selector: '.bot-card strong' })));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start game' })).toBeEnabled());
  fireEvent.click(screen.getByText('Black', { selector: 'button' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
  await waitFor(() => expect(location().pathname).toBe('/play'));
  expect(loadPlay()).toMatchObject({ botId: 'leela', engineId: 'lc0', botName: 'Leela Zero' });
  await waitFor(() => expect(server.calls.find(c => c.path === 'api/engine')?.body).toMatchObject({ play: true, engineId: 'lc0' }));
}, 15000);

test('a Maia model bot plays as itself on Lc0', async () => {
  const server = serveMoves();
  const maia = { id: 'maia-1500', name: 'Maia 1500', installed: true, rating_target: 1500, style: 'human', download: null };
  server.on('api/engines', () => ({ engines: [STOCKFISH, engineEntry('lc0', 'Leela Chess Zero', { installed: true, type: 'neural', models: [maia] })] }));
  server.on('api/engine', () => ({ best: 'e2e4', lines: [] }));
  const { location } = renderAt('/play/bots/engines');
  fireEvent.click(botCard(await screen.findByText('Maia 1500', { selector: '.bot-card strong' })));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start game' })).toBeEnabled());
  fireEvent.click(screen.getByText('Black', { selector: 'button' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
  await waitFor(() => expect(location().pathname).toBe('/play'));
  expect(loadPlay()).toMatchObject({ botId: 'model-lc0-maia-1500', engineId: 'lc0', modelId: 'maia-1500', botName: 'Maia 1500' });
  await waitFor(() => expect(server.calls.find(c => c.path === 'api/engine')?.body).toMatchObject({ play: true, engineId: 'lc0', modelId: 'maia-1500' }));
}, 15000);

test('resigning ends the game and shows its stars', async () => {
  serveMoves();
  savePlay({ initialFen: START, moves: [{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }], playerColor: 'white', level: 4,
    result: null, botId: 'baron-blunder', elo: 330 });
  renderAt('/play');
  fireEvent.click(await screen.findByRole('button', { name: /Resign/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, resign' }));
  expect(await screen.findByRole('heading', { name: 'You resigned' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: '0 of 3 stars' })).toBeInTheDocument();
  expect(loadPlay()).toMatchObject({ resigned: true, result: '0-1', rewarded: true });
});

test('a won game awards three stars once and keeps the best per bot', async () => {
  serveMoves();
  savePlay({ initialFen: START, moves: [{ uci: 'e2e4', san: 'e4' }], playerColor: 'white', level: 4,
    result: '1-0', resigned: true, botId: 'marcus-moss', elo: 1180 });
  renderAt('/play');
  expect(await screen.findByRole('heading', { name: 'You won!' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: '3 of 3 stars' })).toBeInTheDocument();
  expect(screen.getByText('New best against Marcus Moss!')).toBeInTheDocument();
  expect(screen.getByText(/Well played. That was clean./)).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('chess-jd-stars-v1') ?? '{}')).toEqual({ 'marcus-moss': 3 });
  expect(loadPlay()?.rewarded).toBe(true);
});

test('when you play Black, Stockfish moves first and the game is saved after its move', async () => {
  const server = serveMoves();
  server.on('api/engine', body => ({ best: body?.play ? 'e2e4' : null, lines: [] }));
  savePlay({ initialFen: START, moves: [], playerColor: 'black', level: 10, result: null });
  renderAt('/play');
  expect(await screen.findByRole('button', { name: /Go to move 1, e4/ })).toBeInTheDocument();
  expect(server.calls.find(c => c.path === 'api/engine')?.body).toMatchObject({ play: true, level: 10, moves: [] });
  expect(loadPlay()?.moves).toEqual([{ uci: 'e2e4', san: 'e4' }]);
});

test('your move is played, saved, and answered; earlier positions cannot be overwritten', async () => {
  const server = serveMoves();
  server.on('api/engine', () => ({ best: 'e7e5', lines: [] }));
  savePlay({ initialFen: START, moves: [], playerColor: 'white', level: 4, result: null });
  renderAt('/play');
  const target = await screen.findByRole('button', { name: 'White pawn on e2' });
  await act(async () => { fireEvent.click(target); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Empty e4' })); });
  await waitFor(() => expect(loadPlay()?.moves.map(m => m.uci)).toEqual(['e2e4', 'e7e5']));
  expect(loadPlay()?.timings).toEqual([
    expect.objectContaining({ ply: 1, uci: 'e2e4', elapsed_ms: expect.any(Number), source: 'ui_active', partial: true }),
  ]);

  fireEvent.click(screen.getByRole('button', { name: 'First move' }));
  expect(await screen.findByRole('button', { name: /Return to current position/ })).toBeInTheDocument();
  const again = await screen.findByRole('button', { name: 'White pawn on e2' });
  await act(async () => { fireEvent.click(again); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Empty e4' })); });
  expect(await screen.findByText(/This is an earlier position/)).toBeInTheDocument();
  expect(loadPlay()?.moves).toHaveLength(2);
});

test('the game screen offers no engine help', async () => {
  serveMoves();
  savePlay({ initialFen: START, moves: [], playerColor: 'white', level: 4, result: null });
  renderAt('/play');
  await screen.findByRole('button', { name: 'White pawn on e2' });
  expect(screen.queryByText('Stockfish 18', { selector: '.engine-heading strong' })).not.toBeInTheDocument();
  expect(document.querySelector('.eval-track')).not.toBeInTheDocument();
});

test('a finished game is recorded for awards and the dialog shows what it earned', async () => {
  const server = serveMoves();
  server.on('api/played', () => ({ recorded: true, improved: [{ id: 'checkmate', title: 'Checkmate', tier: 'bronze' }] }));
  savePlay({ initialFen: START, moves: [{ uci: 'e2e4', san: 'e4' }], playerColor: 'white', level: 4,
    result: '1-0', resigned: true, botId: 'marcus-moss', elo: 1180 });
  renderAt('/play');
  expect(await screen.findByText('Bronze reached')).toBeInTheDocument();
  const call = server.calls.find(c => c.path === 'api/played')?.body;
  expect(call).toMatchObject({ result: '1-0', playerColor: 'white', moves: ['e2e4'], botId: 'marcus-moss', elo: 1180 });
  expect(call?.gameId).toBe(loadPlay()?.gameId);
});

test('a rated bot can play each phase at its own strength, sent with every move', async () => {
  const server = serveMoves();
  server.on('api/engine', () => ({ best: 'e2e4', lines: [], phase: 'opening', elo: 1000, slip: false }));
  const { location } = renderAt('/play/bots/always');
  fireEvent.click(botCard(await screen.findByText('Granny Rose', { selector: '.bot-card strong' })));
  fireEvent.click(screen.getByText('Set each phase', { selector: 'button' }));
  const [opening] = screen.getAllByRole('slider');
  fireEvent.change(opening, { target: { value: '1000' } });
  fireEvent.click(screen.getByText('Black', { selector: 'button' }));
  fireEvent.click(screen.getByText(/Start game/, { selector: 'button' }));
  await waitFor(() => expect(location().pathname).toBe('/play'));
  expect(loadPlay()?.phaseElo).toEqual({ opening: 1000, middlegame: 2600, endgame: 2600 });
  await waitFor(() => expect(server.calls.find(c => c.path === 'api/engine')?.body)
    .toMatchObject({ play: true, phaseElo: { opening: 1000, middlegame: 2600, endgame: 2600 } }));
  // The bot keeps its own record of the move: phase, rating, and whether it was a deliberate slip.
  await waitFor(() => expect(loadPlay()?.botNotes).toEqual([{ ply: 1, slip: false, phase: 'opening', elo: 1000 }]));
}, 15000);

test('with the coach, a mistake is held before it is played, and can be played anyway', async () => {
  const server = serveMoves();
  server.on('api/engine', () => ({ best: 'e7e5', lines: [] }));
  server.on('api/coach/check', () => ({ verdict: 'worse', loss: 420, line: ['e4', 'Qh4'], uci: ['e2e4', 'd8h4'], motifs: ['fork'],
    material: -3, best: { uci: 'd2d4', san: 'd4' } }));
  savePlay({ initialFen: START, moves: [], playerColor: 'white', level: 4, result: null, coached: true });
  renderAt('/play');
  const pawn = await screen.findByRole('button', { name: 'White pawn on e2' });
  await act(async () => { fireEvent.click(pawn); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Empty e4' })); });
  expect(await screen.findByText('Hold on, e4 is a mistake.')).toBeInTheDocument();
  expect(screen.getByText(/fork two of your pieces/)).toBeInTheDocument();
  expect(server.calls.some(c => c.path === 'api/move')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Play it anyway' }));
  await waitFor(() => expect(loadPlay()?.moves.map(m => m.uci)).toEqual(['e2e4', 'e7e5']));
}, 15000);

test('with the coach, you can take back your move and the reply; the game earns no stars', async () => {
  serveMoves();
  savePlay({ initialFen: START, moves: [{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }], playerColor: 'white', level: 4,
    result: null, coached: true, botId: 'marcus-moss', elo: 1180 });
  renderAt('/play');
  fireEvent.click(await screen.findByRole('button', { name: 'Take back' }));
  expect(loadPlay()).toMatchObject({ moves: [], takebacks: 1 });
});

test('the result shows how the game was played, phase by phase, and the bot keeps its rating', async () => {
  const server = serveMoves();
  const row = (accuracy: number) => ({ moves: 4, accuracy, inaccuracy: 0, mistake: 0, blunder: 0 });
  server.on('api/played/report', () => ({
    phases: { opening: { you: row(91), bot: row(64) }, middlegame: { you: null, bot: null }, endgame: { you: null, bot: null } },
    overall: { you: row(91), bot: row(64) }, slips: [{ ply: 4, san: 'Nc6', phase: 'opening', class: null }], luckySlips: 1,
    ratings: { opening: [1180] },
  }));
  savePlay({ initialFen: START, moves: [{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }], playerColor: 'white', level: 4,
    result: '1-0', resigned: true, botId: 'marcus-moss', elo: 1180, botNotes: [{ ply: 2, slip: true, elo: 1180, phase: 'opening' }] });
  renderAt('/play');
  expect(await screen.findByRole('heading', { name: 'How the game was played' })).toBeInTheDocument();
  expect(screen.getByText('91%')).toBeInTheDocument();
  expect(screen.getByText(/played every move at 1180/)).toBeInTheDocument();
  expect(screen.getByText(/happened to be a good move: luck, not a stronger bot/)).toBeInTheDocument();
  expect(server.calls.find(c => c.path === 'api/played/report')?.body).toMatchObject({
    moves: ['e2e4', 'e7e5'], playerColor: 'white', notes: [{ ply: 2, slip: true, elo: 1180, phase: 'opening' }] });
});

test('Rooky reads your turn once, greets you, and gives a hint a rung at a time and names its threat', async () => {
  const server = serveMoves();
  server.on('api/coach/hint', () => ({ best: { uci: 'g1f3', san: 'Nf3', piece: 'knight', motifs: ['fork'] },
    threat: { uci: 'd8h4', san: 'Qh4', piece: 'queen', motifs: ['mateIn1'], gain: 0 } }));
  savePlay({ initialFen: START, moves: [], playerColor: 'white', level: 4, result: null, coached: true, botId: 'coach-rooky', elo: 900 });
  renderAt('/play');
  expect(await screen.findByText(/Hi, I am Rooky/)).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Hint' }));
  expect(await screen.findByText('One of your pieces can attack two things at once.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Which piece?' }));
  expect(await screen.findByText('Move your knight.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'What are you threatening?' }));
  expect(await screen.findByText('I threaten checkmate with Qh4!')).toBeInTheDocument();
  // One read of the position serves every rung.
  expect(server.calls.filter(c => c.path === 'api/coach/hint')).toHaveLength(1);
});

test('mid-game, Rooky speaks up unasked when it has a big threat', async () => {
  const server = serveMoves();
  server.on('api/coach/hint', () => ({ best: { uci: 'g1f3', san: 'Nf3', piece: 'knight', motifs: [] },
    threat: { uci: 'd8h4', san: 'Qh4', piece: 'queen', motifs: ['mateIn1'], gain: 0 } }));
  savePlay({ initialFen: START, moves: [{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }], playerColor: 'white', level: 4,
    result: null, coached: true, botId: 'coach-rooky', elo: 900 });
  renderAt('/play');
  expect(await screen.findByText('Careful: I have a threat. Can you spot it before you move?')).toBeInTheDocument();
});

test('Rooky is the one coach: its card starts a coached game at your rating; other bots have no coach option', async () => {
  fakeServer();
  const { location } = renderAt('/play/bots/always');
  fireEvent.click(botCard(await screen.findByText('Granny Rose', { selector: '.bot-card strong' })));
  expect(screen.queryByText('Play with the coach', { selector: 'button' })).not.toBeInTheDocument();
  fireEvent.click(botCard(screen.getByText('Rooky', { selector: '.bot-card strong' })));
  fireEvent.click(screen.getByText(/Start game/, { selector: 'button' }));
  await waitFor(() => expect(location().pathname).toBe('/play'));
  expect(loadPlay()).toMatchObject({ botId: 'coach-rooky', coached: true, elo: 900 });
});

test('the result offers your costliest mistake again, as a practice game with the coach', async () => {
  const server = serveMoves();
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
  server.on('api/played/report', () => ({
    phases: { opening: { you: null, bot: null }, middlegame: { you: null, bot: null }, endgame: { you: null, bot: null } },
    overall: { you: null, bot: null }, slips: [], luckySlips: 0, ratings: {}, retry: { ply: 3, san: 'Qh5', class: 'mistake', fen },
  }));
  savePlay({ initialFen: START, moves: [{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }], playerColor: 'white', level: 4,
    result: '0-1', resigned: true, botId: 'marcus-moss', elo: 1180 });
  const { location } = renderAt('/play');
  fireEvent.click(await screen.findByRole('button', { name: /Try your mistake again \(2\. Qh5\)/ }));
  await waitFor(() => expect(loadPlay()).toMatchObject({ initialFen: fen, moves: [], coached: true, botId: 'marcus-moss', elo: 1180 }));
  expect(location().pathname).toBe('/play');
});

test('a regular in costume plays as the character: its name, opening line and mechanics', async () => {
  serveMoves();
  // Iron Wall Ivo dressed as El Silbón for the Venezuelan legends keeps his id; the game keeps the costume.
  savePlay({ initialFen: START, moves: [], playerColor: 'white', level: 4, result: null, botId: 'iron-wall-ivo', elo: 1655,
    botName: 'El Silbón', costume: 'El Silbón', outfit: 'art/bots/seasonal/leyendas/08-6.webp' });
  renderAt('/play');
  expect(await screen.findByText('“Do, re, mi, fa, sol, la, si... did you hear that?”')).toBeInTheDocument();
  expect(screen.getByText(/Fi-fi-fi/)).toBeInTheDocument();
  expect(screen.getAllByText('El Silbón').length).toBeGreaterThan(0);
  expect(screen.queryByText('Iron Wall Ivo')).not.toBeInTheDocument();
  expect(document.body.dataset.ambience).toBe('night');
});

test('a character bot speaks up in its own voice when your move hands it the game', async () => {
  const server = serveMoves();
  // Real move counters, so the page can tell whose move each board shows.
  server.on('api/position', body => {
    const moves = body?.moves as string[];
    const board = boardAfter(moves);
    return { ...board, fen: `${board.fen.split(' ')[0]} ${moves.length % 2 ? 'b' : 'w'} - - 0 ${Math.floor(moves.length / 2) + 1}` };
  });
  // Granny Rose read +0.20 after her first move, and +4.00 once you replied: a blunder.
  server.on('api/engine', () => ({ best: 'g1f3', lines: [], slip: false, before: 400, after: 380 }));
  savePlay({ initialFen: START, moves: [{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }], playerColor: 'black', level: 4, result: null,
    botId: 'granny-rose', elo: 2600, botName: 'Granny Rose', botNotes: [{ ply: 1, slip: false, before: 30, after: 20 }] });
  renderAt('/play');
  expect(await screen.findByText('“Look again at what you just left.”')).toBeInTheDocument();
  expect(server.calls.find(c => c.path === 'api/engine')?.body).toMatchObject({ play: true, read: true });
  expect(loadPlay()?.botNotes?.at(-1)).toMatchObject({ ply: 3, before: 400, after: 380 });
});

test('a bot with mechanics greets you with its line and sets the night board', async () => {
  serveMoves();
  savePlay({ initialFen: START, moves: [], playerColor: 'white', level: 4, result: null, botId: 'el-silbo-n', elo: 1550, botName: 'El Silbón' });
  renderAt('/play');
  expect(await screen.findByText('“Do, re, mi, fa, sol, la, si... did you hear that?”')).toBeInTheDocument();
  expect(document.body.dataset.ambience).toBe('night');
});
