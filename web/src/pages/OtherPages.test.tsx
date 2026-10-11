import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useEngine } from '../hooks/useChess';
import { savePlay } from '../lib/storage';
import { appBasename } from '../lib/base';
import { resetCoachReady } from '../components/CoachExplain';
import { fakeServer, renderAt, START } from '../test/harness';
import { continueNode } from './HomePage';
import { STORY_CHAPTERS } from '../data/story';
import type { DrillDeck, InsightsData, LessonCard, LessonCategory } from '../types';

const insights = (extra: Partial<InsightsData> = {}): InsightsData => ({
  user: 'jhd3197', games: 10, wins: 6, draws: 1, losses: 3, avgAcc: 80, avgCpl: 40, blPerGame: 1.2, totalBlunders: 12,
  mistakes: 5, inaccuracies: 9, coverage: { analyzed: 4, total: 10 },
  series: [{ id: 1, date: '2026.09.01', acpl: 40, acc: 80, blunders: 1, result: 1, opp: 'Duke-BOT' }],
  phases: [], colors: [], opponents: [], openings: [], recurring: [], concepts: [], worstBlunders: [], ...extra,
});

const lesson = (slug: string, category: LessonCategory, completed: string | null = null): LessonCard => ({
  slug, title: `Lesson ${slug}`, summary: 'A lesson.', category, level: 'beginner', minutes: 5,
  requires: [], unit: null, practice: null, step: 0, completed, steps: 3,
});

const profile = { xp: 240, level: 3, xpIntoLevel: 40, xpForLevel: 300, streak: { count: 4, doneToday: false, goal: 30, xpToday: 12 } };

describe('Home', () => {
  test('the hero points START at the current story node, with practice and today below', async () => {
    const server = fakeServer();
    server.on('api/lessons', () => ({ lessons: [lesson('how-pieces-move', 'basics', '2026-09-01'), lesson('the-rules', 'basics')], problems: [] }));
    server.on('api/puzzles', () => ({ rating: 1523, rated: 10, total: 100, missed: 2, trend: [], themes: [], groups: [], recent: [], problems: [] }));
    server.on('api/today', () => ({ drills: { due: 1, new: 1, new_total: 5, total: 5, learned: 2, next_due: null },
      reviews: { due: 1, scheduled: 2, next_due: null }, mine: { total: 0, fresh: 0, today: 0 }, todo: 3 }));
    server.on('api/profile', () => profile);
    renderAt('/');
    // The hero: first uncompleted node of the first unlocked chapter.
    expect(await screen.findByRole('heading', { name: 'Lesson the-rules' })).toBeInTheDocument();
    expect(screen.getByText('Chapter 1 · First Moves · Lesson')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start the lesson' })).toHaveAttribute('href', '/story/lesson/the-rules');
    // Practice row: three doors, with live stats (the rail has its own
    // Puzzles link, so match the card by its stat line).
    expect(screen.getByRole('link', { name: /Puzzles Rating/ })).toHaveAttribute('href', '/puzzles');
    expect(screen.getByText('Rating 1523')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Fix your mistakes/ })).toHaveAttribute('href', '/train');
    expect(await screen.findByText('3 things to fix today.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Play a bot/ })).toHaveAttribute('href', '/play/bots');
    // Today: streak, this week as seven cells, today's goal.
    expect(screen.getByText('4-day streak')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Today' }).querySelectorAll('.home-week li')).toHaveLength(7);
    expect(screen.getByRole('progressbar', { name: 'Today’s XP goal' })).toHaveAttribute('aria-valuenow', '12');
  });

  test('a saved game gets a slim continue banner above the hero', async () => {
    const server = fakeServer();
    server.on('api/lessons', () => ({ lessons: [lesson('the-rules', 'basics')], problems: [] }));
    savePlay({ initialFen: START, moves: [{ uci: 'e2e4', san: 'e4' }], playerColor: 'white', level: 4, result: null });
    renderAt('/');
    const banner = await screen.findByRole('link', { name: /Game in progress/ });
    expect(banner).toHaveAttribute('href', '/play');
    expect(banner).toHaveTextContent('you vs. Stockfish, 1 move in');
  });

  test('an unreachable catalog still lands on the story map', async () => {
    fakeServer();
    renderAt('/');
    expect(await screen.findByText('The story map is unreachable.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Story' })).toHaveAttribute('href', '/story');
  });

  test('continueNode walks the chapters in order and knows when the journey is done', () => {
    const catalog = { lessons: [lesson('a', 'basics', '2026-09-01'), lesson('b', 'basics')], problems: [] };
    // The first undone lesson of the first unlocked chapter is current.
    expect(continueNode(catalog, {})?.node.lesson?.slug).toBe('b');
    // Lessons done: the gauntlet is next, then the boss.
    const lessonsDone = { lessons: [lesson('a', 'basics', '2026-09-01')], problems: [] };
    expect(continueNode(lessonsDone, {})?.node.kind).toBe('gauntlet');
    localStorage.setItem('story-gauntlet-first-moves', '1');
    expect(continueNode(lessonsDone, {})?.node.kind).toBe('boss');
    // Boss beaten: chapter 2 opens even with no lessons of its own.
    expect(continueNode(lessonsDone, { 'charlie-scout': 1 })?.chapter.id).toBe('the-mating-net');
    // Everything done everywhere: nothing left to continue.
    for (const chapter of STORY_CHAPTERS) localStorage.setItem(`story-gauntlet-${chapter.id}`, '1');
    const stars = Object.fromEntries(STORY_CHAPTERS.map(chapter => [chapter.bossBotId, 1]));
    expect(continueNode({ lessons: [], problems: [] }, stars)).toBeNull();
  });

  test('a finished journey gets a celebratory hero', async () => {
    const server = fakeServer();
    server.on('api/lessons', () => ({ lessons: [], problems: [] }));
    server.on('api/profile', () => profile);
    for (const chapter of STORY_CHAPTERS) localStorage.setItem(`story-gauntlet-${chapter.id}`, '1');
    localStorage.setItem('chess-jd-stars-v1', JSON.stringify(Object.fromEntries(STORY_CHAPTERS.map(chapter => [chapter.bossBotId, 1]))));
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Journey complete.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Revisit the map' })).toHaveAttribute('href', '/story');
  });
});

describe('Analyze all', () => {
  test('the banner starts the job and shows progress', async () => {
    const server = fakeServer();
    let running = false;
    server.on('api/analysis', () => ({ running, total: 3, done: running ? 1 : 0, failed: 0, current: running ? { opponent: 'Duke-BOT' } : null, error: null, remaining: 3, outdated: 0, engine: true }));
    server.on('api/analysis/start', () => { running = true; return { running, total: 3, done: 0, failed: 0, current: null, error: null, engine: true }; });
    server.on('api/insights', () => insights());
    renderAt('/insights');
    fireEvent.click(await screen.findByRole('button', { name: 'Analyze all' }));
    expect(await screen.findByText('1 of 3 · vs Duke-BOT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });
});

describe('Insights', () => {
  test('Your moves shows all eight grades and identifies incomplete reanalysis', async () => {
    fakeServer().on('api/insights', () => insights({
      grades: { brilliant: 1, great: 2, best: 3, good: 4, book: 5, inaccuracy: 6, mistake: 7, blunder: 8 },
      gradeCoverage: { current: 20, total: 36 },
    }));
    renderAt('/insights');
    expect(await screen.findByRole('heading', { name: 'Your moves' })).toBeInTheDocument();
    expect(screen.getByText('36 analyzed moves')).toBeInTheDocument();
    expect(screen.getByText(/Updated ratings: 20 of 36 moves/)).toBeInTheDocument();
    const tiles = document.querySelectorAll('.quality-tile');
    expect(tiles).toHaveLength(8);
    expect([...tiles].reduce((sum, tile) => sum + Number(tile.querySelector('strong')!.textContent), 0)).toBe(36);
    expect(document.querySelector('.q-great img')).toHaveAttribute('src', 'art/grades/icon/great.webp');
    expect(document.querySelector('.q-book img')).toHaveAttribute('src', 'art/grades/icon/book.webp');
  });

  test('each section has its own URL', async () => {
    const server = fakeServer();
    server.on('api/insights', () => insights({
      openings: [{ eco: 'C50', name: 'Italian Game', color: 'white', games: 4, winrate: 75, w: 3, d: 0, l: 1, fen: START, line: '1. e4 e5', acpl: 30, analyzed: 2, recent: [] }],
    }));
    renderAt('/insights/openings');
    expect(await screen.findByText('Italian Game')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Openings' })).toHaveClass('active');
    expect(screen.getByText('4 / 10 games analyzed')).toBeInTheDocument();
  });

  test('an unknown section falls back to the overview', async () => {
    fakeServer().on('api/insights', () => insights());
    const { location } = renderAt('/insights/nope');
    await waitFor(() => expect(location().pathname).toBe('/insights'));
  });
});

describe('Train', () => {
  const deck = (extra: Partial<DrillDeck> = {}): DrillDeck => ({
    total: 5, learned: 0, due: 0, new: 5, new_total: 5, new_per_day: 10, next_due: null,
    card: { id: '7:12', game_id: 7, ply: 12, fen: START, class: 'blunder', move_number: 6, opponent: 'Duke-BOT', date: '2026.09.05' }, ...extra,
  });

  test('a missed drill shows the engine move and links to the game', async () => {
    const server = fakeServer();
    server.on('api/drills', () => deck());
    server.on('api/drills/answer', () => ({
      correct: false, verdict: 'blunder', san: 'd4', best_san: 'e4', best: 'e2e4', played: 'Qh5', game_id: 7, ply: 12,
      next_review: new Date(Date.now() + 10 * 60000).toISOString(), next: deck({ learned: 1, new: 4, card: null, next_due: new Date(Date.now() + 600000).toISOString() }),
    }));
    renderAt('/train');
    const pawn = await screen.findByRole('button', { name: 'White pawn on d2' });
    await act(async () => { fireEvent.click(pawn); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Empty d4' })); });
    expect(await screen.findByText(/would be a blunder/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(server.calls.find(c => c.path === 'api/drills/answer')?.body).toEqual({ id: '7:12', move: 'd2d4' });
    expect(screen.getByRole('link', { name: 'Replay game' })).toHaveAttribute('href', '/games/7/11');
    fireEvent.click(screen.getByRole('button', { name: /Next position/ }));
    expect(await screen.findByText('All caught up')).toBeInTheDocument();
  });

  test("the day's plan lists drills, puzzles to retry and new puzzles from your games", async () => {
    const server = fakeServer();
    server.on('api/drills', () => deck());
    server.on('api/today', () => ({ drills: { due: 2, new: 3, new_total: 5, total: 5, learned: 0, next_due: null },
      reviews: { due: 0, scheduled: 1, next_due: null }, mine: { total: 9, fresh: 9, today: 5 }, todo: 10 }));
    renderAt('/train');
    expect(await screen.findByRole('heading', { name: 'Today: 10 things to fix' })).toBeInTheDocument();
    expect(screen.getByText('Nothing due. Missed puzzles come back here.')).toBeInTheDocument();
    const starts = screen.getAllByRole('link', { name: 'Start' });
    expect(starts.map(a => a.getAttribute('href'))).toEqual(['/puzzles/from-your-games']);  // the drills are this page
  });

  test('the coach explains the game move once the drill is answered', async () => {
    resetCoachReady();
    const server = fakeServer();
    server.on('api/drills', () => deck());
    server.on('api/coach/status', () => ({ available: true }));
    server.on('api/explain', body => (body as { cachedOnly?: boolean }).cachedOnly ? { answer: null } : { answer: { text: 'Qh5 hangs the queen.' } });
    server.on('api/drills/answer', () => ({
      correct: false, verdict: 'blunder', san: 'd4', best_san: 'e4', best: 'e2e4', played: 'Qh5', game_id: 7, ply: 12,
      next_review: new Date(Date.now() + 600000).toISOString(), next: deck({ card: null }),
    }));
    renderAt('/train');
    const pawn = await screen.findByRole('button', { name: 'White pawn on d2' });
    await act(async () => { fireEvent.click(pawn); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Empty d4' })); });
    fireEvent.click(await screen.findByRole('button', { name: 'Why was Qh5 a mistake?' }, { timeout: 4000 }));
    expect(await screen.findByText('Qh5 hangs the queen.', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(server.calls.filter(c => c.path === 'api/explain').map(c => c.body)).toEqual([
      { fen: START, move: 'Qh5', cachedOnly: true }, { fen: START, move: 'Qh5' }]);
    resetCoachReady();
  });

  test('an empty deck explains how to build one', async () => {
    fakeServer().on('api/drills', () => deck({ total: 0, new: 0, new_total: 0, card: null }));
    renderAt('/train');
    expect(await screen.findByText('No drills yet')).toBeInTheDocument();
  });
});

describe('engine analysis', () => {
  test('a late result for an earlier position is never shown for the current one', async () => {
    const resolvers: ((value: Response) => void)[] = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => resolvers.push(resolve))));
    const { result, rerender } = renderHook(({ moves }) => useEngine(START, moves, true, 0), { initialProps: { moves: [] as { uci: string; san: string }[] } });
    await waitFor(() => expect(resolvers).toHaveLength(1));
    rerender({ moves: [{ uci: 'e2e4', san: 'e4' }] });
    await act(async () => {
      resolvers[0](new Response(JSON.stringify({ lines: [{ cp: 999, mate: null, moves: [], uci: [] }], best: 'd2d4' })));
    });
    expect(result.current.result).toBeNull();
    expect(result.current.status).toBe('pending');
  });
});

describe('base path', () => {
  test('the basename comes from the page <base>', () => {
    const base = document.createElement('base');
    base.href = 'http://localhost/apps/chess/';
    document.head.append(base);
    try { expect(appBasename()).toBe('/apps/chess'); } finally { base.remove(); }
    expect(appBasename()).toBe('/');
  });
});
