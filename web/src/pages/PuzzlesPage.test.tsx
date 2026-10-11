import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { boardAfter, fakeServer, renderAt, START, playMove } from '../test/harness';
import type { Puzzle, PuzzleAttempt, PuzzleCatalog, PuzzleTheme } from '../types';
import voice from '../i18n/locales/en/voice.json';
import { cleanMoment, piecesInWords } from './PuzzlesPage';
import { puzzleAutoNext, puzzleHelp, showRatings } from '../lib/settings';

const theme = (extra: Partial<PuzzleTheme> = {}): PuzzleTheme => ({
  slug: 'fork', title: 'Forks', summary: 'One piece attacks two targets at once.', group: 'tactics', count: 240,
  attempted: 0, solved_first: 0, missed: 0, low: 545, high: 2790, ...extra,
});

const attempt = (extra: Partial<PuzzleAttempt> = {}): PuzzleAttempt => ({
  id: 'abc12', at: new Date().toISOString(), result: 'missed', misses: ['Qd2'], hint: false, revealed: false, seconds: 14,
  puzzle_rating: 1640, rated: true, delta: -11, rating: 1489, themes: ['Forks'], ...extra,
});

const catalog = (extra: Partial<PuzzleCatalog> = {}): PuzzleCatalog => ({
  rating: 1489, rated: 12, total: 4500, missed: 3, trend: [1500, 1520, 1489], groups: ['checkmates', 'tactics'],
  themes: [theme({ attempted: 8, solved_first: 3, missed: 2 }), theme({ slug: 'mate-in-1', title: 'Mate in 1', group: 'checkmates', attempted: 4, solved_first: 4 })],
  recent: [attempt()], problems: [], weak: ['fork'], week: 24, avg_seconds: 31, runs: { streak: { best: 7, played: 3 }, storm: { best: 0, played: 0 } }, ...extra,
});

// White's e4 sets it up; Black (the solver) answers e5, White replies Nf3, Black finishes with Nc6.
const PUZZLE: Puzzle = {
  id: 'abc12', fen: START, setup: { uci: 'e2e4', san: 'e4' },
  moves: [{ uci: 'e7e5', san: 'e5' }, { uci: 'g1f3', san: 'Nf3' }, { uci: 'b8c6', san: 'Nc6' }],
  rating: 1640, mate: false, themes: [{ slug: 'fork', title: 'Forks' }], game: 'https://lichess.org/abcdefgh#3', progress: null,
};

function serve(result: Partial<PuzzleAttempt> = {}) {
  const server = fakeServer();
  server.on('api/puzzles', () => catalog());
  server.on('api/puzzles/abc12', () => PUZZLE);
  server.on(/^api\/puzzles\/next/, () => ({ id: 'zzz99' }));
  server.on('api/puzzles/zzz99', () => ({ ...PUZZLE, id: 'zzz99' }));
  server.on('api/position', body => {
    const moves = body?.moves as string[];
    return boardAfter(moves, moves.length % 2 ? ['e7e5', 'd7d5', 'b8c6'] : ['e2e4', 'g1f3']);
  });
  server.on('api/move', body => ({ ...boardAfter([...(body?.moves as string[]), String(body?.move)]), san: 'd5', uci: String(body?.move) }));
  // Mirrors puzzles.grade(): one wrong move or a hint is a partial solve; two wrong moves or a reveal is a miss.
  server.on('api/puzzles/attempt', body => {
    const misses = (body?.misses as string[]).length;
    const score = body?.revealed ? 0 : Math.min(misses ? [0.6, 0.4, 0.2][Math.min(misses, 3) - 1] : 1, body?.hint ? 0.5 : 1);
    return attempt({ result: score >= 0.5 ? 'solved' : 'missed', score, time_bonus: 0, delta: 9, rating: 1498, ...result });
  });
  return server;
}

/** Wait until the board shows a piece, so a click lands on the current position. */
const shows = (name: string) => screen.findByRole('button', { name }, { timeout: 3000 });

const move = (from: string, to: string) => playMove(new RegExp(`on ${from}$`), new RegExp(`${to}$`));

describe('Puzzles', () => {
  test('the overview shows the rating, ways to practise, themes by group and recent attempts', async () => {
    serve();
    renderAt('/puzzles');
    expect(await screen.findByText('Puzzles', { selector: '.puzzles-title' })).toBeInTheDocument();
    expect(await screen.findByText('1489', { selector: '#puzzle-rating' })).toBeInTheDocument();
    expect(screen.getByText('12 rated', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('+24 this week')).toHaveClass('up');
    expect(screen.getByText('58%')).toBeInTheDocument();
    expect(screen.getByText('31s')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Solve rated puzzles.*Picked near 1489/ })).toHaveAttribute('href', '/puzzles/mixed');
    expect(screen.getByRole('link', { name: /^Retry\s*3 due$/ })).toHaveAttribute('href', '/puzzles/missed');
    expect(screen.getByRole('heading', { name: 'Checkmates' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Forks.*One piece attacks/ })).toHaveAttribute('href', '/puzzles/fork');
    expect(screen.getByText('8 tried · 38% first try · 2 missed')).toBeInTheDocument();
    const recent = screen.getByRole('region', { name: 'Recent attempts' });
    expect(recent).toHaveTextContent('0 solved · 1 missed');
    expect(screen.getByText('tried Qd2')).toBeInTheDocument();
    expect(screen.getByText('−11')).toBeInTheDocument();
  });

  test('themes filter by started and by a search word', async () => {
    const server = serve();
    server.on('api/puzzles', () => catalog({ themes: [...catalog().themes, theme({ slug: 'pin', title: 'Pins', summary: 'A piece that cannot move.' })] }));
    renderAt('/puzzles');
    expect(await screen.findByText('3 themes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Pins.*Not started.*Start/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Started' }));
    expect(screen.getByText('2 of 3 themes')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Pins/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Forks.*Continue/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not started' }));
    expect(screen.getByRole('link', { name: /Pins/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Checkmates' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All themes' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a theme' }), { target: { value: 'mate' } });
    expect(screen.getByText('1 of 3 themes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mate in 1/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Forks.*One piece/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a theme' }), { target: { value: 'zzz' } });
    expect(screen.getByText(/No themes match/)).toBeInTheDocument();
  });

  test('how scoring works opens on demand', async () => {
    serve();
    renderAt('/puzzles');
    const toggle = await screen.findByRole('button', { name: /How scoring works/ });
    expect(screen.queryByText('Misses come back')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('Misses come back')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hide scoring/ })).toHaveAttribute('aria-expanded', 'true');
  });

  test('a theme without a puzzle in the URL opens the next one', async () => {
    const server = serve();
    const { location } = renderAt('/puzzles/fork');
    await waitFor(() => expect(location().pathname).toBe('/puzzles/fork/zzz99'));
    expect(server.calls.some(c => c.path === 'api/puzzles/next?theme=fork')).toBe(true);
  });

  test('the opponent moves first; a wrong move is tracked and the solve gets partial credit', async () => {
    const server = serve();
    const { location } = renderAt('/puzzles/fork/abc12');
    expect(await screen.findByText(/Watch your opponent/)).toBeInTheDocument();
    await shows('White pawn on e4');
    // The goal is said up front: a non-mate puzzle wins material or a big advantage.
    expect(screen.getByText('Find the best move: it wins material or a big advantage.', { exact: false })).toBeInTheDocument();

    await move('d7', 'd5');
    expect(await screen.findByText(/is not it/)).toBeInTheDocument();
    await move('e7', 'e5');
    expect(await screen.findByText(/Nf3/, { selector: '.lesson-line li' }, { timeout: 3000 })).toBeInTheDocument();
    await shows('White knight on f3');
    await move('b8', 'c6');

    expect(await screen.findByText('✓ Solved with help')).toBeInTheDocument();
    expect(screen.getByText(/You tried d5 first. Partial credit/)).toBeInTheDocument();
    expect(screen.getByText(/Score 60%/)).toBeInTheDocument();
    expect(server.calls.find(c => c.path === 'api/puzzles/attempt')?.body).toMatchObject({ id: 'abc12', misses: ['d5'], hint: false, revealed: false });
    expect(screen.getByText('Puzzle rating 1640', { exact: false })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Next puzzle/ }));
    await waitFor(() => expect(location().pathname).toBe('/puzzles/fork/zzz99'));
    expect(server.calls.some(c => c.path === 'api/puzzles/next?theme=fork&after=abc12')).toBe(true);
  });

  test('after the puzzle, the solution can be stepped back and forth on the board', async () => {
    serve();
    renderAt('/puzzles/fork/abc12');
    await shows('White pawn on e4');
    await move('e7', 'e5');
    await shows('White knight on f3');
    await move('b8', 'c6');
    expect(await screen.findByText('The solution')).toBeInTheDocument();
    await shows('Black knight on c6');
    // Back one ply: Nc6 is taken back, the knight is home again.
    fireEvent.click(screen.getByRole('button', { name: /Back$/ }));
    expect(await shows('Black knight on b8')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Forward/ }));
    expect(await shows('Black knight on c6')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to your game' }));
    expect(screen.queryByRole('button', { name: 'Back to your game' })).not.toBeInTheDocument();
  });

  test('a clean solve moves the rating up; a hint makes the same line a partial solve', async () => {
    const server = serve();
    renderAt('/puzzles/fork/abc12');
    await shows('White pawn on e4');
    await move('e7', 'e5');
    expect(await screen.findByText(/Nf3/, { selector: '.lesson-line li' }, { timeout: 3000 })).toBeInTheDocument();
    await shows('White knight on f3');
    await move('b8', 'c6');
    expect(await screen.findByText('✓ Solved')).toBeInTheDocument();
    expect(await screen.findByText('+9')).toBeInTheDocument();
    expect(screen.getByText('Your rating 1498')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Hint' }, { timeout: 3000 }));
    expect(screen.getByText(/circled piece/)).toBeInTheDocument();
    await shows('White pawn on e4');
    await move('e7', 'e5');
    expect(await screen.findByText(/Nf3/, { selector: '.lesson-line li' }, { timeout: 3000 })).toBeInTheDocument();
    await shows('White knight on f3');
    await move('b8', 'c6');
    expect(await screen.findByText('✓ Solved with help')).toBeInTheDocument();
    expect(screen.getByText(/Score 50%/)).toBeInTheDocument();
    expect(server.calls.filter(c => c.path === 'api/puzzles/attempt').at(-1)?.body).toMatchObject({ misses: [], hint: true });
  });

  test('settings: hint only, ratings hidden, and a clean solve moving on by itself', async () => {
    puzzleHelp.set('hint');
    showRatings.set(false);
    puzzleAutoNext.set(true);
    serve();
    const { location } = renderAt('/puzzles/fork/abc12');
    await shows('White pawn on e4');
    expect(screen.getByRole('button', { name: 'Hint' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show the solution/ })).not.toBeInTheDocument();
    await move('e7', 'e5');
    expect(await screen.findByText(/Nf3/, { selector: '.lesson-line li' }, { timeout: 3000 })).toBeInTheDocument();
    await shows('White knight on f3');
    await move('b8', 'c6');
    expect(await screen.findByText('✓ Solved')).toBeInTheDocument();
    expect(screen.queryByText('+9')).not.toBeInTheDocument();
    expect(screen.queryByText(/Your rating/)).not.toBeInTheDocument();
    await waitFor(() => expect(location().pathname).toBe('/puzzles/fork/zzz99'), { timeout: 4000 });
  });

  test('the coach reacts out loud: a word on a wrong try, praise on a clean solve', async () => {
    const said: string[] = [];
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      onend: (() => void) | null = null; onerror: (() => void) | null = null; rate = 1; pitch = 1; voice: unknown = null;
      constructor(public text: string) { /* noop */ }
    });
    vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel: () => {}, speak: (u: { text: string }) => said.push(u.text) });
    try {
      serve();
      renderAt('/puzzles/fork/abc12');
      await shows('White pawn on e4');
      await move('d7', 'd5');
      await waitFor(() => expect(said.some(line => voice.wrong.includes(line))).toBe(true));
      await move('e7', 'e5');
      await shows('White knight on f3');
      await move('b8', 'c6');
      expect(await screen.findByText('✓ Solved with help')).toBeInTheDocument();
      // A puzzle solved after a wrong try gets a kind word, not praise.
      await waitFor(() => expect(said.at(-1)).toMatch(/Not this time|Close/));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('the overview offers the weak themes, Streak and Storm', async () => {
    serve();
    renderAt('/puzzles');
    expect(await screen.findByRole('link', { name: /^Weak spots\s*Forks$/ })).toHaveAttribute('href', '/puzzles/weak');
    expect(screen.getByRole('link', { name: /^Puzzle Streak\s*Best: 7$/ })).toHaveAttribute('href', '/puzzles/streak');
    expect(screen.getByRole('link', { name: /^Puzzle Storm\s*3 minutes, as many as you can$/ })).toHaveAttribute('href', '/puzzles/storm');
  });

  test('without weak themes, misses or history the tiles say so', async () => {
    const server = serve();
    server.on('api/puzzles', () => catalog({ weak: [], missed: 0, week: 0, recent: [] }));
    renderAt('/puzzles');
    await screen.findByText('1489', { selector: '#puzzle-rating' });
    expect(screen.queryByRole('link', { name: /Weak spots/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Retry\s*Nothing due$/ })).toBeInTheDocument();
    expect(screen.queryByText(/this week/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Recent attempts' })).not.toBeInTheDocument();
  });

  test('the weak batch asks the server for weak-theme puzzles', async () => {
    const server = serve();
    const { location } = renderAt('/puzzles/weak');
    await waitFor(() => expect(location().pathname).toBe('/puzzles/weak/zzz99'));
    expect(server.calls.some(c => c.path === 'api/puzzles/next?theme=weak')).toBe(true);
  });

  test('a Streak climbs puzzle by puzzle and one wrong move ends it, unrated', async () => {
    const server = serve();
    server.on(/^api\/puzzles\/next/, (_, path) => ({ id: path.includes('index=0') ? 'abc12' : 'zzz99' }));
    server.on('api/puzzles/run', body => ({ mode: 'streak', score: body?.score, best: 7, new_best: false, played: 4 }));
    renderAt('/puzzles/streak');
    expect(await screen.findByText(/one wrong move ends the run/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hint' })).not.toBeInTheDocument();
    await shows('White pawn on e4');
    await move('e7', 'e5');
    await shows('White knight on f3');
    await move('b8', 'c6');
    expect(await screen.findByText('Score 1', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(server.calls.some(c => c.path === 'api/puzzles/next?run=streak&index=1&exclude=abc12')).toBe(true);

    await shows('White pawn on e4');
    await move('d7', 'd5');
    expect(await screen.findByRole('heading', { name: 'Streak over' })).toBeInTheDocument();
    expect(screen.getByText(/You solved 1 puzzle. You played d5; the move was e5./)).toBeInTheDocument();
    expect(await screen.findByText('Best 7', { selector: '#puzzle-run-over *' })).toBeInTheDocument();
    expect(server.calls.find(c => c.path === 'api/puzzles/run')?.body).toEqual({ mode: 'streak', score: 1 });
    expect(server.calls.some(c => c.path === 'api/puzzles/attempt')).toBe(false);
  });

  test('a Storm runs on the clock: a wrong move skips ahead and costs time', async () => {
    const server = serve();
    server.on(/^api\/puzzles\/next/, (_, path) => ({ id: path.includes('index=0') ? 'abc12' : 'zzz99' }));
    server.on('api/puzzles/run', body => ({ mode: 'storm', score: body?.score, best: 0, new_best: false, played: 1 }));
    renderAt('/puzzles/storm');
    expect(await screen.findByText(/^[23]:\d\d$/, { selector: '#puzzle-run-clock' })).toBeInTheDocument();
    await shows('White pawn on e4');
    await move('d7', 'd5');
    expect(await screen.findByText('−10s')).toBeInTheDocument();
    await waitFor(() => expect(server.calls.some(c => c.path === 'api/puzzles/next?run=storm&index=1&exclude=abc12')).toBe(true));
    const [minutes, seconds] = screen.getByText(/^\d:\d\d$/, { selector: '#puzzle-run-clock' }).textContent!.split(':').map(Number);
    expect(minutes * 60 + seconds).toBeLessThanOrEqual(170);
    expect(screen.getByText('Score 0')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'End run' }));
    expect(await screen.findByRole('heading', { name: 'Time’s up' })).toBeInTheDocument();
    await waitFor(() => expect(server.calls.find(c => c.path === 'api/puzzles/run')?.body).toEqual({ mode: 'storm', score: 0 }));
    expect(server.calls.some(c => c.path === 'api/puzzles/attempt')).toBe(false);
  });

  test('blindfold hides the pieces, describes the position and still takes moves', async () => {
    const server = serve();
    const { container } = renderAt('/puzzles/fork/abc12');
    await shows('White pawn on e4');
    fireEvent.click(screen.getByRole('button', { name: 'Blindfold' }));
    expect(screen.queryByRole('button', { name: /pawn on/ })).not.toBeInTheDocument();
    expect(container.querySelector('#board img')).toBeNull();
    expect(screen.getByText('White: Ke1, Qd1, Ra1, Rh1, Bc1, Bf1, Nb1, Ng1, a2, b2, c2, d2, e2, f2, g2, h2')).toBeInTheDocument();
    expect(screen.getByText('Then White played e4.')).toBeInTheDocument();
    const square = (name: string) => container.querySelector(`[data-square="${name}"]`)!;
    expect(square('e4')).toHaveClass('last-move');
    await act(async () => { fireEvent.click(square('e7')); });
    await act(async () => { fireEvent.click(square('e5')); });
    expect(await screen.findByText(/Nf3/, { selector: '.lesson-line li' }, { timeout: 3000 })).toBeInTheDocument();
    expect(server.calls.some(c => c.path === 'api/move')).toBe(false); // the expected move needs no server check

    fireEvent.click(screen.getByRole('button', { name: 'Show the pieces' }));
    expect(await shows('White knight on f3')).toBeInTheDocument();
  });

  test('pieces in words list the king first and pawns as squares', () => {
    const fen = '1q4k1/5ppp/8/8/8/8/1P3PPP/4R1K1 b - - 0 1';
    expect(piecesInWords(fen, true)).toBe('Kg1, Re1, b2, f2, g2, h2');
    expect(piecesInWords(fen, false, 'RDTAC')).toBe('Rg8, Db8, f7, g7, h7');
  });

  test('a finished puzzle earns the quip for its moment', () => {
    const solve = { clean: true, mate: false, captured: false, seconds: 30, streak: 1 };
    expect(cleanMoment({ ...solve, mate: true })).toBe('mate');
    expect(cleanMoment({ ...solve, streak: 3 })).toBe('streak');
    expect(cleanMoment({ ...solve, seconds: 5 })).toBe('fast');
    expect(cleanMoment({ ...solve, captured: true })).toBe('capture');
    expect(cleanMoment(solve)).toBe('great');
    expect(cleanMoment({ ...solve, clean: false })).toBeNull();
  });
});
