import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { fakeServer } from '../test/harness';
import type { GameStatsData, StatsRow } from '../types';
import { GameStats } from './GameStats';

const row = (extra: Partial<StatsRow> = {}): StatsRow => ({ moves: 100, inaccuracy: 8, mistake: 4, blunder: 2, error_rate: 14, blunder_rate: 2, acpl: 40, ...extra });
const stats = (extra: Partial<GameStatsData> = {}): GameStatsData => ({
  counts: { games: 40, analyzed: 12, timed_games: 0 },
  accuracy: { opening: row({ accuracy: 86.2 }), middlegame: row({ accuracy: 91.2 }), endgame: row({ moves: 0 }), overall: row({ accuracy: 88.4 }) },
  heatmap: { bucket_size: 5, by_move: [row({ bucket: '1-5', error_rate: 16 }), row({ bucket: '6-10', error_rate: 19 }), row({ bucket: '61+', moves: 0 })], peak: '6-10' },
  time: { timed_moves: 0, by_think_time: [], by_clock: [] },
  tilt: { recommendation: { break_after_losses: 2, text: 'x' } },
  performance: { by_rating: { much_higher: { games: 6, wins: 1, draws: 1, losses: 4, score_pct: 25 } } },
  summary: { weaknesses: ['Accuracy is lowest in the opening.'], facts: [] },
  ...extra,
});

describe('GameStats', () => {
  test('shows phase accuracy, the error heatmap, opponent strength and coach notes', async () => {
    fakeServer().on('api/stats', () => stats());
    render(<MemoryRouter><GameStats /></MemoryRouter>);
    expect(await screen.findByText('Accuracy by phase')).toBeInTheDocument();
    expect(screen.getByText('Opening')).toBeInTheDocument();
    expect(screen.queryByText('Endgame')).not.toBeInTheDocument();  // no endgame moves
    expect(screen.getByText('Moves 6-10')).toBeInTheDocument();
    expect(screen.queryByText('Moves 61+')).not.toBeInTheDocument();
    expect(screen.getByText('Your errors peak at moves 6-10.')).toBeInTheDocument();
    expect(screen.getByText('1 / 1 / 4')).toBeInTheDocument();
    expect(screen.getByText(/Analyze games played with a clock/)).toBeInTheDocument();
    expect(screen.getByText('Take a break after 2 losses in a row: your score drops after that.')).toBeInTheDocument();
    expect(screen.getByText('Accuracy is lowest in the opening.')).toBeInTheDocument();
  });

  test('blind spots link each tactic to its puzzles and to a game, and phases to their training', async () => {
    const example = { game_id: 7, ply: 12, fen: '8/8/8/8/8/8/8/8 w - - 0 1', date: '2026.09.01', opponent: 'Duke' };
    fakeServer().on('api/stats', () => stats({ motifs: { errors: 40, missed: [],
      allowed: [{ tag: 'hangingPiece', slug: 'hanging-piece', count: 12, examples: [example], trend: { recent: 1.5, earlier: 3, direction: 'better' } }, { tag: 'fork', slug: 'fork', count: 5, examples: [] }] } }));
    render(<MemoryRouter><GameStats /></MemoryRouter>);
    expect(await screen.findByText('Your blind spots')).toBeInTheDocument();
    expect(screen.getByText('A hanging piece')).toBeInTheDocument();
    expect(screen.getByText('12 times')).toBeInTheDocument();
    expect(screen.getByText('Rarer lately: 1.5 per 10 games, down from 3.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Practice these puzzles' }).map(a => a.getAttribute('href'))).toEqual(['/puzzles/hanging-piece', '/puzzles/fork']);
    expect(screen.getByRole('link', { name: 'See it vs Duke' })).toHaveAttribute('href', '/games/7/11');
    expect(screen.getByText('No tactic stands out in what you missed.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Train this phase' }).map(a => a.getAttribute('href'))).toEqual(['/openings', '/puzzles/weak']);
  });

  test('stays hidden until some games are analyzed', async () => {
    const server = fakeServer();
    server.on('api/stats', () => stats({ counts: { games: 3, analyzed: 0, timed_games: 0 } }));
    const { container } = render(<MemoryRouter><GameStats /></MemoryRouter>);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(server.calls.some(c => c.path === 'api/stats')).toBe(true);
    expect(container).toBeEmptyDOMElement();
  });
});
