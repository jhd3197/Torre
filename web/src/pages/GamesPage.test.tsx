import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { boardAfter, fakeServer, renderAt, START } from '../test/harness';
import { SCORING_VERSION } from '../lib/grades';
import type { GameDetail } from '../types';

const MOVES = [
  { uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }, { uci: 'g1f3', san: 'Nf3' }, { uci: 'b8c6', san: 'Nc6' },
];

function game(id: number, extra: Partial<GameDetail> = {}): GameDetail {
  return {
    initialFen: START, moves: MOVES, headers: { White: 'jhd3197', Black: 'Duke-BOT', Result: '1-0', Date: '2026.09.05' },
    record: { id, user_color: 'white', opponent: 'Duke-BOT' },
    analysis: {
      id, scoring_version: SCORING_VERSION, accuracy: 91.4,
      moves: [
        { ply: 1, san: 'e4', class: null, best: true, brilliant: false, accuracy: 100 },
        { ply: 3, san: 'Nf3', class: 'blunder', best: false, brilliant: false, accuracy: 20 },
      ],
      worst_moves: [{ ply: 3, move_number: 2, san: 'Nf3', fen: START, class: 'blunder', cpl: 500 }],
    },
    ...extra,
  };
}

// Games and positions are cached per page load, so each review test needs a game no other test has opened.
const unseen = (id: number, ...ucis: string[]) => game(id, { moves: ucis.map(uci => ({ uci, san: uci })) });

/** Hold the review's analysis until the test lets it go, so the loading section can be seen. */
function holdReview(server: ReturnType<typeof fakeServer>) {
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  server.on('api/review', async body => {
    if (body?.cachedOnly) return { plies: [] };
    await gate;
    const moves = body?.moves as string[], from = Number(body?.from), to = Number(body?.to);
    return { plies: Array.from({ length: to - from + 1 }, (_, i) => ({
      ply: from + i, state: boardAfter(moves.slice(0, from + i)),
      lines: [{ cp: 34, mate: null, moves: ['e4', 'e5'], uci: ['e2e4', 'e7e5'], depth: 14 }], best: 'e2e4',
    })) };
  });
  return () => release();
}

/** Wait for the opening review to finish and the panel to show the game. */
const reviewed = () => waitFor(() => expect(screen.queryByRole('status', { name: 'Reviewing your game' })).toBeNull(), { timeout: 4000 });

test('archive offers a portable game-data download alongside PGN, under More', async () => {
  serve(190);
  renderAt('/games/190');
  fireEvent.click(await screen.findByRole('button', { name: 'More' }));
  expect(screen.getByRole('menuitem', { name: 'Export game data' })).toHaveAttribute('href', 'api/games/190/export');
  expect(screen.getByRole('menuitem', { name: 'Export PGN' })).toHaveAttribute('href', 'api/games/190/pgn');
});

function serve(id: number, detail = game(id)) {
  const server = fakeServer();
  server.on('api/games', () => ({ games: [{ id, opponent: 'Duke-BOT', date: '2026.09.05', user_result: 1, user_color: 'white', plies: 4 }], engine: true }));
  server.on(`api/games/${id}`, () => detail);
  return server;
}

test('shows the recognized opening and actual move order without an AI coach', async () => {
  serve(191, game(191, { opening: {
    name: "King's Knight Opening", eco: 'C40', ply: 3, move_number: 2, move: 'Nf3',
    played_by: 'white', line: '1. e4 1... e5 2. Nf3', moves: ['e4', 'e5', 'Nf3'],
    transposed: true, family_idea: null, continuation: ['2... Nc6'],
  } }));
  const { location } = renderAt('/games/191');
  // A game opened as a whole opens on the Summary tab, where the opening sits.
  await reviewed();
  expect(await screen.findByText("King's Knight Opening · C40")).toBeVisible();
  expect(screen.getByRole('button', { name: 'Summary' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('This game reached the opening through a different move order.')).toBeInTheDocument();
  fireEvent.click(screen.getByText('How this game reached the opening'));
  expect(screen.getByText('1. e4 1... e5 2. Nf3')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Go to the opening position' }));
  await waitFor(() => expect(location().pathname).toBe('/games/191/3'));
});

test('the move is part of the URL, and stepping replaces it without piling up history', async () => {
  serve(101);
  const { location, router } = renderAt('/games/101/2');
  expect(await screen.findByRole('button', { name: /Go to move 1, e5/ })).toHaveAttribute('aria-current', 'step');
  fireEvent.click(screen.getByRole('button', { name: 'Next move' }));
  await waitFor(() => expect(location().pathname).toBe('/games/101/3'));
  fireEvent.keyDown(window, { key: 'ArrowLeft' });
  await waitFor(() => expect(location().pathname).toBe('/games/101/2'));
  expect(router.state.historyAction).toBe('REPLACE');
});

test('without a move in the URL a game opens at the starting position', async () => {
  serve(102);
  renderAt('/games/102');
  await reviewed();
  fireEvent.click(await screen.findByRole('button', { name: 'Moves' }));
  await screen.findByRole('button', { name: /Go to move 1, e4/ });
  expect(document.querySelector('[aria-current="step"]')).toBeNull();
});

test('/games lists the saved games instead of jumping into one', async () => {
  serve(103);
  const { location } = renderAt('/games');
  expect(await screen.findByRole('region', { name: 'Saved games' })).toBeInTheDocument();
  expect(location().pathname).toBe('/games');
});

test('replay analyzes automatically: evaluation bar, engine lines and the best-move arrow', async () => {
  serve(104);
  renderAt('/games/104/0');
  expect(await screen.findByText('+0.34', { selector: '.engine-line b' })).toBeInTheDocument();
  expect(document.querySelector('#eval-value')).toHaveTextContent('+0.34');
  expect(document.querySelector('.eval-track')).not.toHaveClass('pending');
  expect(document.querySelector('#hint-arrow')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Best move/ }));
  expect(document.querySelector('#hint-arrow')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Best move/ })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: /^Engine/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Analysis on' }));
  expect(screen.getByText(/Analysis is paused/)).toBeVisible();
});

test('analysis judgments are marked in the move list', async () => {
  serve(105);
  renderAt('/games/105/0');
  const blunder = await screen.findByRole('button', { name: /Go to move 2, Nf3, blunder/ });
  expect(within(blunder).getByAltText('??')).toBeInTheDocument();
  expect(document.querySelector('.accuracy-card.yours b')).toHaveTextContent('91.4%');
});

test('the accuracy cards say how each side played in rating points, or why not', async () => {
  serve(147, game(147, { rating: { user: 1650, opp: null, speed: 'blitz' } }));
  renderAt('/games/147/0');
  expect(await screen.findByText('Played like ~1650')).toHaveAttribute('title', 'An estimate from this game alone, rounded to 50.');
  expect(screen.getByText('Rating: –')).toHaveAttribute('title', 'Too short to estimate a rating.');
});

test('moving a piece in a replay opens Explore with the move, and Back returns to the same move', async () => {
  serve(106);
  const { location } = renderAt('/games/106/0');
  const e2 = await screen.findByLabelText('White pawn on e2');
  await act(async () => { fireEvent.click(e2); });
  await act(async () => { fireEvent.click(screen.getByLabelText('Empty e4')); });
  await waitFor(() => expect(location().pathname).toBe('/explore'));
  const params = new URLSearchParams(location().search);
  expect(params.get('moves')).toBe('e2e4');
  expect(params.get('from')).toBe('/games/106/0');
  expect(params.get('base')).toBeNull();
});

test('an unknown game explains itself instead of showing a blank board', async () => {
  const server = fakeServer();
  server.on('api/games/999', () => { throw new Error('Game not found.'); });
  renderAt('/games/999');
  expect(await screen.findByText('Game not found.')).toBeInTheDocument();
});

test('a grey arrow shows the move played next, next to the gold best move', async () => {
  serve(107);
  const { router } = renderAt('/games/107/1');
  await screen.findByText('+0.34', { selector: '.engine-line b' });
  // Engine prefers e2e4 (the fake), the game continued 1...e5: both arrows.
  expect(document.querySelector('#hint-arrow')).toBeInTheDocument();
  expect(document.querySelector('#next-arrow')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Played in the game\s*e5/ })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(screen.getByRole('button', { name: /Played in the game/ }));
  expect(document.querySelector('#next-arrow')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Played in the game/ }));

  // From the start the game's move was the engine's: one gold arrow and a match.
  await act(async () => { await router.navigate('/games/107/0', { replace: true }); });
  expect(await screen.findByText('✓ Same move')).toBeInTheDocument();
  expect(document.querySelector('#next-arrow')).not.toBeInTheDocument();
});

test('at the end of a game there is no next move to show', async () => {
  serve(108);
  renderAt('/games/108/4');
  await screen.findByRole('button', { name: /Go to move 2, Nc6/ });
  expect(screen.getByRole('button', { name: 'Played in the game' })).toBeDisabled();
  expect(document.querySelector('#next-arrow')).not.toBeInTheDocument();
});

test('opening a game reviews every move behind a loading section, then shows the game with lines cached', async () => {
  const server = serve(201, unseen(201, 'd2d4', 'd7d5', 'c2c4', 'e7e6'));
  const release = holdReview(server);
  const { location } = renderAt('/games/201');
  expect(await screen.findByRole('status', { name: 'Reviewing your game' })).toBeInTheDocument();
  // No play-through: the board stays put, the moves wait for the review, and a bar counts them off.
  expect(screen.getByRole('progressbar', { name: 'Review progress' })).toHaveAttribute('aria-valuemax', '4');
  expect(screen.getByText('0 / 4 moves')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Previous move' })).toBeNull();
  release();
  await reviewed();
  expect(location().pathname).toBe('/games/201');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Previous move' })).toBeDisabled());
  const engineCalls = server.calls.filter(c => c.path === 'api/engine').length;
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  await waitFor(() => expect(location().pathname).toBe('/games/201/1'));
  expect(server.calls.filter(c => c.path === 'api/engine')).toHaveLength(engineCalls);
}, 15000); // steps through a whole review; slow in jsdom when the suite runs in parallel

test('the review can be skipped, and the board is yours again', async () => {
  holdReview(serve(202, unseen(202, 'c2c4', 'e7e5', 'b1c3', 'g8f6')));
  const { location } = renderAt('/games/202');
  fireEvent.click(await screen.findByRole('button', { name: 'Skip to summary' }));
  await reviewed();
  expect(location().pathname).toBe('/games/202');
  expect(await screen.findByRole('button', { name: 'Previous move' })).toBeInTheDocument();
});

test('stepping onto a blunder shows its verdict, the better move, and a badge on its square', async () => {
  // Its own start (only the halfmove clock differs), so no earlier test's review of these positions is reused.
  const server = serve(131, game(131, { initialFen: START.replace(' 0 1', ' 1 1'), analysis: { ...game(131).analysis!, best_moves: ['e2e4', 'e7e5', 'f1c4', 'b8c6'] } }));
  server.on('api/line', body => {
    const moves = body?.moves as string[];
    return { moves: moves.map(uci => ({ uci, san: uci === 'f1c4' ? 'Bc4' : uci })) };
  });
  // Before 2. Nf3 the review saw three better moves; after it, White is losing.
  const line = (cp: number, san: string, uci: string) => ({ cp, mate: null, moves: [san], uci: [uci], depth: 14 });
  server.on('api/review', body => {
    if (body?.cachedOnly) return { plies: [] };
    const moves = body?.moves as string[], from = Number(body?.from), to = Number(body?.to);
    return { plies: Array.from({ length: to - from + 1 }, (_, i) => from + i).map(ply => ({
      ply, state: boardAfter(moves.slice(0, ply)), best: ply === 2 ? 'f1c4' : 'e2e4',
      lines: ply === 2 ? [line(40, 'Bc4', 'f1c4'), line(30, 'Nc3', 'b1c3'), line(25, 'd4', 'd2d4')] : [line(ply === 3 ? -300 : 34, 'e4', 'e2e4')],
    })) };
  });
  renderAt('/games/131/3');
  expect(await screen.findByText('2. Nf3 is a blunder', { exact: false })).toBeInTheDocument();
  // The picks come from the review, which plays through the game first.
  expect(await screen.findByText('3 better moves were there', { exact: false }, { timeout: 6000 })).toBeInTheDocument();
  const picks = document.querySelector('.verdict-picks')!;
  expect([...picks.querySelectorAll('li')].map(li => li.textContent)).toEqual(['1Bc4+0.40', '2Nc3+0.30', '3d4+0.25', 'YouNf3-3.00']);
  expect(document.querySelector('[data-square="f3"] .grade-mark.grade-blunder')).not.toBeNull();

  // Hovering a pick shows the position before 2. Nf3 with that move drawn; leaving puts the board back.
  fireEvent.mouseEnter(within(picks as HTMLElement).getByText('Bc4').closest('button')!);
  await waitFor(() => expect(screen.getByRole('button', { name: 'White knight on g1' })).toBeInTheDocument());
  expect(document.querySelector('#hint-arrow')).toBeInTheDocument();
  fireEvent.mouseLeave(picks);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'White knight on g1' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: /Show the position before it/ }));
  await waitFor(() => expect(screen.queryByText('2. Nf3 is a blunder', { exact: false })).toBeNull());
}, 15000);

test('a game reviewed before opens without the play-through, already graded', async () => {
  const detail = unseen(132, 'e2e4', 'e7e5', 'd1h5');
  const server = serve(132, { ...detail, analysis: undefined });
  const lines = (cp: number) => [{ cp, mate: null, moves: ['x'], uci: ['a2a3'], depth: 14 }];
  const evals = [30, 30, 30, -400]; // Qh5 throws away four pawns' worth: a blunder
  server.on('api/review', body => ({ plies: evals.map((cp, ply) => ({
    ply, state: boardAfter((body?.moves as string[]).slice(0, ply)), lines: lines(cp), best: 'g1f3' })) }));
  renderAt('/games/132/3');
  expect(await screen.findByText('2. d1h5 is a blunder', { exact: false })).toBeInTheDocument();
  expect(screen.queryByRole('status', { name: 'Reviewing the game' })).toBeNull();
  expect(server.calls.filter(c => c.path === 'api/review').every(c => c.body?.cachedOnly)).toBe(true);
});

test('every move keeps a verdict, theirs labelled "Played", and the start holds its place', async () => {
  const grade = (best: boolean, cls: 'blunder' | null = null) => ({ class: cls, best, brilliant: false, accuracy: best ? 100 : 20 });
  serve(133, game(133, { analysis: { ...game(133).analysis!, move_grades: [grade(true), grade(false), grade(false, 'blunder'), grade(true)] } }));
  const { location } = renderAt('/games/133/0');
  expect(await screen.findByText('Ready when you are')).toBeInTheDocument();
  await reviewed();
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  await waitFor(() => expect(location().pathname).toBe('/games/133/2'));
  expect(await screen.findByText('1… e5 is a good move', { exact: false })).toBeInTheDocument();
  // Their move is reviewed too; its row says "Played", and the card keeps all four rows.
  const picks = document.querySelector('.verdict-picks')!;
  await waitFor(() => expect(picks.textContent).toContain('Played'));
  expect(picks.querySelectorAll('li')).toHaveLength(4);
});

test('the summary shows how it ended, both accuracies, your moves by grade, and a table against your opponent', async () => {
  const grade = (cls: 'blunder' | 'mistake' | null) => ({ class: cls, best: !cls, brilliant: false, accuracy: 50 });
  serve(134, game(134, { analysis: { ...game(134).analysis!, opp_accuracy: 63.2, move_grades: [grade(null), grade('mistake'), grade('blunder'), grade('mistake')] } }));
  renderAt('/games/134');
  await reviewed();
  expect(await screen.findByText('You won')).toBeVisible();
  expect([...document.querySelectorAll('.accuracy-card b')].map(b => b.textContent)).toEqual(['91.4%', '63.2%']);
  expect([...document.querySelectorAll('.grade-chips li')].map(li => li.textContent)).toEqual(['1 Best', '1 Blunder']);
  fireEvent.click(screen.getByText('Compare grades with Duke-BOT'));
  const table = await screen.findByRole('table', { name: 'Analysis summary' });
  expect([...table.querySelectorAll('thead th')].map(th => th.textContent)).toEqual(['', 'jhd3197', 'Duke-BOT']);
  const row = (name: string) => [...within(table).getByRole('rowheader', { name }).closest('tr')!.querySelectorAll('td')].map(td => td.textContent);
  expect(row('Accuracy')).toEqual(['91.4%', '63.2%']);
  expect(row('Best')).toEqual(['1', '0']);
  expect(row('Blunder')).toEqual(['1', '0']);
  expect(row('Mistake')).toEqual(['0', '2']);
});

test('Rooky says the recap on its own once the review is in, then offers the lesson from the game', async () => {
  const server = serve(193);
  server.on('api/games/193/coach', () => ({ lesson: 'game-193', focusSkill: 'fork', completed: null,
    lines: ["That ties in with what we're working on: forks.", 'I made you a lesson from this game. Want to see it?'] }));
  renderAt('/games/193');
  await reviewed();
  // The Summary tab opens for the recap; the coach's lines follow the game's.
  const lesson = await screen.findByRole('link', { name: 'Learn from this game' });
  expect(lesson).toHaveAttribute('href', '/lessons/game-193');
  expect(lesson).toBeVisible();
  expect(screen.getByText('I made you a lesson from this game. Want to see it?', { exact: false })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Your Coach plan' })).toHaveAttribute('href', '/coach');
  expect(JSON.parse(localStorage.getItem('chess-jd-rooky-heard') ?? '[]')).toContain('recap:193');
});

test('the summary lists your key moments, each jumping to the position before it, and accuracy by phase', async () => {
  const row = (accuracy: number) => ({ moves: 2, accuracy, inaccuracy: 0, mistake: 0, blunder: 0 });
  serve(135, game(135, {
    analysis: { ...game(135).analysis!, key_moments: [{ ply: 3, move_number: 2, san: 'Nf3', class: 'blunder', win_before: 55, win_after: 12 }] },
    phases: { opening: { you: row(88), bot: row(71) }, middlegame: { you: null, bot: null }, endgame: { you: null, bot: null } },
  }));
  const { location } = renderAt('/games/135');
  await reviewed();
  fireEvent.click(await screen.findByRole('button', { name: /Move 2: Nf3/ }));
  await waitFor(() => expect(location().pathname).toBe('/games/135/2'));
  // Stepping brings the moves forward; the summary is a tab away.
  expect(screen.getByRole('button', { name: 'Moves' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Summary' }));
  expect(screen.getByText('88%')).toBeInTheDocument();
  expect(screen.getByText('71%')).toBeInTheDocument();
});

test('the evaluation strip opens a graph of the whole game, and Escape puts it away', async () => {
  serve(136, game(136, { analysis: { ...game(136).analysis!, evals: [[30, null], [25, null], [40, null], [-280, null], [-260, null]] } }));
  renderAt('/games/136/3');
  fireEvent.click(await screen.findByRole('button', { name: 'Show the evaluation graph' }));
  const sheet = screen.getByRole('region', { name: 'Evaluation' });
  expect(within(sheet).getByText(/2\. Nf3\s+-2\.80\s+Blunder/)).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Evaluation' })).toBeNull();
});

test('stepping through from the summary starts at the first move on the Moves tab', async () => {
  serve(137);
  const { location } = renderAt('/games/137');
  await reviewed();
  fireEvent.click(await screen.findByRole('button', { name: 'Step through the game' }));
  expect(screen.getByRole('button', { name: 'Moves' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Pause replay' })).toBeInTheDocument();
  await waitFor(() => expect(location().pathname).toBe('/games/137/1'), { timeout: 3000 });
});

test('on torre.sh the game and the current move share as links', async () => {
  const server = serve(192);
  server.on('auth/me', () => ({ name: 'Ana', email: 'ana@example.com', admin: false }));
  server.on('auth/share', body => ({ url: `https://torre.sh/g/${body?.game}-${body?.ply ?? 'all'}` }));
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  renderAt('/games/192/3');
  await reviewed();
  fireEvent.click(await screen.findByRole('button', { name: 'Share' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://torre.sh/g/192-all'));
  expect(screen.queryByRole('button', { name: 'Copy PGN' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Share this move' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://torre.sh/g/192-3'));
  expect(server.calls.filter(c => c.path === 'auth/share').map(c => c.body)).toEqual([{ game: '192', ply: null }, { game: '192', ply: 3 }]);
});

test('on your own computer there is no share link, only the PGN copy', async () => {
  serve(193);
  renderAt('/games/193/3');
  await reviewed();
  expect(await screen.findByRole('button', { name: 'Copy PGN' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Share this move' })).toBeNull();
});

function brilliantGame(id: number) {
  const detail = game(id);
  detail.analysis!.moves = [
    { ply: 2, san: 'e5', class: null, best: true, brilliant: true, accuracy: 100 },
    { ply: 3, san: 'Nf3', class: null, best: true, brilliant: true, accuracy: 100 },
  ];
  return detail;
}

test('a brilliant move of yours is celebrated once per visit, and can be shared', async () => {
  serve(194, brilliantGame(194));
  const { router, container } = renderAt('/games/194/3');
  await reviewed();
  expect(await screen.findByText('Brilliant move!')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Share this brilliant move' })).toBeInTheDocument();
  expect(screen.getByTestId('move-celebration')).toHaveClass('fresh');
  expect(container.ownerDocument.querySelector('.confetti')).not.toBeNull();

  // The opponent's brilliant move is not yours to celebrate.
  await act(() => router.navigate('/games/194/2', { replace: true }));
  await waitFor(() => expect(screen.queryByTestId('move-celebration')).toBeNull());

  // Back on it, the badge and the button stay, but the burst does not play again.
  await act(() => router.navigate('/games/194/3', { replace: true }));
  expect(await screen.findByTestId('move-celebration')).not.toHaveClass('fresh');
  expect(container.ownerDocument.querySelector('.confetti')).toBeNull();
});

test('with reduced motion a brilliant move gets no falling paper', async () => {
  localStorage.setItem('chess-jd-motion', 'reduce');
  serve(195, brilliantGame(195));
  const { container } = renderAt('/games/195/3');
  await reviewed();
  expect(await screen.findByTestId('move-celebration')).toHaveClass('fresh');
  expect(container.ownerDocument.querySelector('.confetti')).toBeNull();
});
