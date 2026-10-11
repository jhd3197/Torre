// /profile — the header (name, level, XP, streak), the rating tiles, the archive panels, awards
// and the doorway cards.
import { act, screen, within } from '@testing-library/react';
import { fakeServer, renderAt } from '../test/harness';

const PROFILE = { xp: 240, level: 3, xpIntoLevel: 40, xpForLevel: 300, streak: { count: 4, doneToday: false, goal: 30, xpToday: 12 } };

const GAMES = [
  { id: 'g3', date: '2026.10.01', opponent: 'magnus', user_color: 'white', user_result: 1, user_rating: 1642, plies: 68, user_accuracy: 88.4 },
  { id: 'g2', date: '2026.09.28', opponent: 'hikaru', user_color: 'black', user_result: 0, user_rating: 1620, plies: 54 },
  { id: 'g1', date: '2026.08.01', opponent: 'magnus', user_color: 'white', user_result: 0.5, user_rating: 1584, plies: 120 },
];

const INSIGHTS = {
  user: 'jhd3197', games: 3, wins: 1, draws: 1, losses: 1, avgAcc: 82.3, avgCpl: 40, blPerGame: 1,
  totalBlunders: 3, mistakes: 4, inaccuracies: 5, coverage: { analyzed: 2, total: 3 },
  series: [], phases: [], colors: [], recurring: [], concepts: [], worstBlunders: [],
  opponents: [{ opp: 'magnus', games: 2, w: 1, d: 1, l: 0, acpl: null }, { opp: 'hikaru', games: 1, w: 0, d: 0, l: 1, acpl: null }],
  openings: [{ eco: 'C50', name: 'Italian Game', color: 'white', games: 2, winrate: 50, w: 1, d: 1, l: 0, fen: '', line: '', acpl: null, analyzed: 1, recent: [] }],
};

const award = (id: string, title: string, level: number, tier: string, count: number, next: number | null) =>
  ({ id, family: 'milestones', title, description: '', unit: 'games', thresholds: [1, 10, 50, 100], count, level, tier, next });

function fullServer() {
  const server = fakeServer();
  server.on('api/profile', () => PROFILE);
  server.on('api/games', () => ({ games: GAMES, engine: true }));
  server.on('api/insights', () => INSIGHTS);
  server.on('api/puzzles', () => ({ rating: 1773, rated: 40, total: 100, missed: 2, trend: [1700, 1740, 1773], themes: [], groups: [], recent: [], problems: [] }));
  server.on('api/achievements', () => ({ awards: [
    award('first-win', 'First win', 2, 'bronze', 12, 50),
    award('marathon', 'Marathon', 0, 'locked', 0, 1),
  ] }));
  return server;
}

describe('Profile', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-05T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  test('shows the name, level, XP progress and streak', async () => {
    fullServer();
    renderAt('/profile');
    await act(async () => {});
    expect(screen.getByRole('heading', { level: 1, name: 'jhd3197' })).toBeInTheDocument();
    expect(screen.getByText('3 games in your archive')).toBeInTheDocument();
    expect(screen.getByText('Level 3')).toBeInTheDocument();
    expect(screen.getByText('40 of 300 XP to level 4')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Progress to the next level' })).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('4-day streak')).toBeInTheDocument();
    expect(screen.getByText('12 of 30 XP toward today’s goal.')).toBeInTheDocument();
    // The shared flame icon (components/story/Streak) renders lit for an active streak.
    expect(document.querySelector('.profile-streak .flame.lit')).not.toBeNull();
  });

  test('rating tiles come from the archive, puzzles, insights and awards', async () => {
    fullServer();
    renderAt('/profile');
    await act(async () => {});
    const tiles = within(screen.getByRole('navigation', { name: 'Your numbers' }));
    expect(tiles.getByRole('link', { name: /Play rating\s*1,642\s*↑ 58 in 30 days/ })).toHaveAttribute('href', '/play/bots');
    expect(tiles.getByRole('link', { name: /Puzzle rating\s*1,773\s*↑ 73 over 3 rated puzzles/ })).toHaveAttribute('href', '/puzzles');
    expect(tiles.getByRole('link', { name: /Accuracy\s*82\.3%\s*Across 2 analyzed games/ })).toHaveAttribute('href', '/coach/progress');
    expect(tiles.getByRole('link', { name: /Awards\s*1 \/ 2\s*Next: First win/ })).toHaveAttribute('href', '/awards');
  });

  test('the record, openings, awards, recent games and opponents panels', async () => {
    fullServer();
    renderAt('/profile');
    await act(async () => {});
    const record = within(screen.getByRole('region', { name: 'Record' }));
    expect(record.getByText('Wins').parentElement).toHaveTextContent('Wins133%');
    expect(record.getByText('Last 3 games')).toBeInTheDocument();
    // Oldest first: the draw, the loss, then the newest win.
    expect([...document.querySelectorAll('.profile-form li')].map(li => li.textContent)).toEqual(['D', 'L', 'W']);

    const openings = within(screen.getByRole('region', { name: 'Your openings' }));
    expect(openings.getByText('Italian Game')).toBeInTheDocument();
    expect(openings.getByLabelText('Score 75%')).toBeInTheDocument();

    const awards = within(screen.getByRole('region', { name: 'Awards' }));
    expect(awards.getByText('1 of 2 earned')).toBeInTheDocument();
    expect(awards.getByText('Bronze')).toBeInTheDocument();
    expect(awards.getByText('0 / 1 games')).toBeInTheDocument();

    const games = within(screen.getByRole('region', { name: 'Recent games' }));
    expect(games.getByRole('link', { name: 'Replay the game against hikaru' })).toHaveAttribute('href', '/games/g2');
    expect(games.getAllByText('vs magnus', { selector: 'strong' })[0].closest('li')).toHaveTextContent('2026 / 10 / 01 · 34 moves · 88%');
    expect(games.getAllByText('Loss')).toHaveLength(1);

    const opponents = within(screen.getByRole('region', { name: 'Most played' }));
    expect(opponents.getByText('2 games · 1–1–0')).toBeInTheDocument();
    expect(opponents.getByLabelText('Score 75%')).toBeInTheDocument();
  });

  test('a met daily goal says so', async () => {
    const server = fakeServer();
    server.on('api/profile', () => ({ ...PROFILE, streak: { count: 5, doneToday: true, goal: 30, xpToday: 45 } }));
    renderAt('/profile');
    await act(async () => {});
    expect(await screen.findByText('Today’s goal is met. See you tomorrow.')).toBeInTheDocument();
  });

  test('with an empty archive it offers a way in and keeps the doorway cards', async () => {
    fakeServer(); // no profile, puzzles or awards fakes: those fetches fail and their parts stay hidden
    renderAt('/profile');
    await act(async () => {});
    expect(screen.getByRole('heading', { level: 1, name: 'Your profile' })).toBeInTheDocument();
    expect(screen.getByText('Loading your profile…')).toBeInTheDocument();
    expect(screen.getByText('No games in your archive yet')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Your numbers' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Import games' })).toHaveAttribute('href', '/import');
    expect(screen.getByRole('link', { name: 'Play a bot' })).toHaveAttribute('href', '/play/bots');
    const cards: [RegExp, string][] = [
      [/Games archive/, '/games'], [/Insights/, '/coach/progress'], [/^Awards/, '/awards'],
      [/Lesson library/, '/lessons'], [/Train & review/, '/train'], [/Settings/, '/settings'],
    ];
    for (const [name, href] of cards) expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
  });
});
