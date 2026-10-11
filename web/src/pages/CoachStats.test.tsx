import { fireEvent, screen, within } from '@testing-library/react';
import { fakeServer, renderAt } from '../test/harness';
import type { GameStatsData, InsightsData, StatsRow } from '../types';

const row = (extra: Partial<StatsRow> = {}): StatsRow => ({ moves: 100, inaccuracy: 8, mistake: 4, blunder: 2, error_rate: 14, blunder_rate: 2, acpl: 40, ...extra });

const INSIGHTS: InsightsData = {
  user: 'player', games: 12, wins: 8, draws: 1, losses: 3, avgAcc: 82.3, avgCpl: 41, blPerGame: 1.5, totalBlunders: 18,
  mistakes: 9, inaccuracies: 20, coverage: { analyzed: 3, total: 12 },
  grades: { best: 60, good: 30, blunder: 10 },
  series: [
    { id: 1, date: '2026.01.01', acpl: 60, acc: 70, blunders: 3, result: 0, opp: 'Old' },
    { id: 2, date: '2026.09.20', acpl: 40, acc: 80, blunders: 1, result: 1, opp: 'Recent' },
    { id: 3, date: '2026.10.01', acpl: 20, acc: 90, blunders: 0, result: 1, opp: 'Newest' },
  ],
  phases: [],
  colors: [{ color: 'white', games: 7, winrate: 71, acpl: 38, bl_per_game: 1.2 }, { color: 'black', games: 5, winrate: 60, acpl: 44, bl_per_game: 1.8 }],
  opponents: Array.from({ length: 10 }, (_, i) => ({ opp: `Rival ${i + 1}`, games: 10 - i, w: 5, d: 1, l: 4 - Math.min(i, 4), acpl: 40 })),
  openings: [], recurring: [], concepts: [], worstBlunders: [],
};

const STATS: GameStatsData = {
  counts: { games: 12, analyzed: 3, timed_games: 2 },
  accuracy: { opening: row({ accuracy: 80.5 }), middlegame: row({ accuracy: 86 }), endgame: row({ accuracy: 93.8 }), overall: row({ accuracy: 85 }) },
  heatmap: { bucket_size: 5, by_move: [row({ bucket: '1-5', error_rate: 16 }), row({ bucket: '6-10', error_rate: 27 }), row({ bucket: '61+', moves: 0 })], peak: '6-10' },
  time: { timed_moves: 40, by_think_time: [row({ bucket: '<2s', error_rate: 9, blunder_rate: 1.5 })], by_clock: [] },
  tilt: { recommendation: { break_after_losses: 1, text: null } },
  performance: { by_rating: { much_higher: { games: 6, wins: 1, draws: 1, losses: 4, score_pct: 25 } } },
  summary: { weaknesses: [], facts: [] },
  motifs: { errors: 5, allowed: [{ tag: 'fork', slug: 'fork', count: 3, examples: [] }], missed: [] },
};

function show() {
  const server = fakeServer();
  server.on('api/insights', () => INSIGHTS);
  server.on('api/stats', () => STATS);
  return renderAt('/coach/progress');
}

describe('Coach stats', () => {
  test('lays out the overview: the title, Rooky\'s read, figures, moves, blind spots and opponents', async () => {
    show();
    expect(await screen.findByRole('heading', { level: 1, name: 'Coach' })).toBeInTheDocument();
    expect(screen.getByText('3 of 12 games analyzed · 100 of your moves checked by Stockfish')).toBeInTheDocument();
    const read = await screen.findByRole('region', { name: "Rooky's read on your stats" });
    expect(within(read).getByText('Your weakest phase: Opening')).toBeInTheDocument();
    expect(within(read).getByText('Your errors peak at moves 6-10.')).toBeInTheDocument();
    expect(read.querySelector('.cursor-rook')).not.toBeNull();
    expect(screen.getByText('82.3%')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your moves' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your blind spots' })).toBeInTheDocument();
    expect(screen.getByText('Peak: moves 6-10')).toBeInTheDocument();
    expect(screen.getByText('White · 7 games')).toBeInTheDocument();
    // Opponents: the top eight, then all of them.
    expect(screen.queryByText('Rival 9')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 10' }));
    expect(screen.getByText('Rival 10')).toBeInTheDocument();
  });

  test('a range narrows the figures and the chart to the analyzed games in it', async () => {
    show();
    await screen.findByRole('heading', { name: 'Form over time' });
    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));
    const games = screen.getAllByText('Games')[0].closest('.coach-kpi')!;
    expect(games).toHaveTextContent('2');
    expect(screen.getAllByText('Analyzed games in this range').length).toBeGreaterThan(0);
  });

  test('/insights keeps its own overview', async () => {
    const server = fakeServer();
    server.on('api/insights', () => INSIGHTS);
    renderAt('/insights');
    expect(await screen.findByText('3 / 12 games analyzed')).toBeInTheDocument();
    expect(document.querySelector('.coach-stats')).toBeNull();
  });
});
