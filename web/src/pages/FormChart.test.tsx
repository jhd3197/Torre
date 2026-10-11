import { fireEvent, screen } from '@testing-library/react';
import { fakeServer, renderAt } from '../test/harness';
import type { InsightsData } from '../types';

function chart(series: InsightsData['series']) {
  const server = fakeServer();
  server.on('api/insights', () => ({
    user: 'player', games: series.length, wins: 1, draws: 0, losses: 1,
    avgAcc: 80, avgCpl: 40, blPerGame: 1, totalBlunders: 1, mistakes: 1, inaccuracies: 1,
    coverage: { analyzed: series.length, total: series.length }, series,
    phases: [], colors: [], opponents: [], openings: [], recurring: [], concepts: [], worstBlunders: [],
  } satisfies InsightsData));
  renderAt('/insights');
}
const games: InsightsData['series'] = [
  { id: 1, date: '2026.01.01', acpl: 40, acc: 80, blunders: 1, result: 1, opp: 'First' },
  { id: 2, date: '2026.02.01', acpl: null, acc: null, blunders: 0, result: .5, opp: 'Middle' },
  { id: 3, date: '2026.03.01', acpl: 20, acc: 90, blunders: 0, result: 0, opp: 'Last' },
];

test('the chart selects the nearest game directly, clamps edges, and keeps Replay on pointer exit', async () => {
  chart(games);
  const group = await screen.findByRole('group', { name: 'Explore game history' });
  const svg = group.querySelector('svg')!;
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 480 } as DOMRect);
  vi.stubGlobal('PointerEvent', MouseEvent);
  expect(document.querySelector('input[type="range"]')).toBeNull();
  fireEvent.pointerMove(svg, { clientX: 0 });
  expect(screen.getByText('First')).toBeInTheDocument();
  const firstReplay = screen.getByRole('link', { name: 'Replay' }).getAttribute('href');
  fireEvent.pointerMove(svg, { clientX: 340 });
  expect(screen.getByText('Middle')).toBeInTheDocument();
  expect(group.querySelectorAll('.chart-point')).toHaveLength(0);
  expect(group.querySelector('.chart-tooltip')).toHaveTextContent('Accuracy: –');
  fireEvent.pointerMove(svg, { clientX: 999 });
  expect(screen.getByText('Last')).toBeInTheDocument();
  expect(group.querySelectorAll('.chart-point')).toHaveLength(2);
  fireEvent.pointerLeave(svg);
  expect(group.querySelector('.chart-tooltip')).toBeNull();
  expect(screen.getByRole('link', { name: 'Replay' }).getAttribute('href')).not.toBe(firstReplay);
  expect(screen.getByText('Last')).toBeInTheDocument();
});

test('keyboard navigation supports arrows and endpoints without connecting missing values', async () => {
  chart(games);
  const group = await screen.findByRole('group', { name: 'Explore game history' });
  fireEvent.keyDown(group, { key: 'Home' });
  expect(screen.getByText('First')).toBeInTheDocument();
  fireEvent.keyDown(group, { key: 'ArrowLeft' });
  expect(screen.getByText('First')).toBeInTheDocument();
  fireEvent.keyDown(group, { key: 'ArrowRight' });
  expect(screen.getByText('Middle')).toBeInTheDocument();
  fireEvent.keyDown(group, { key: 'End' });
  expect(screen.getByText('Last')).toBeInTheDocument();
  expect(document.querySelector('#insight-chart-detail')).toHaveAttribute('aria-live', 'polite');
  expect(group.querySelector('path.chart-accuracy')?.getAttribute('d')).not.toContain('L');
});

test('a single game supports touch and keyboard without invalid coordinates', async () => {
  chart([games[0]]);
  const group = await screen.findByRole('group', { name: 'Explore game history' });
  const svg = group.querySelector('svg')!;
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 480 } as DOMRect);
  const capture = vi.fn();
  Object.defineProperty(svg, 'setPointerCapture', { value: capture });
  const event = new MouseEvent('pointerdown', { bubbles: true, clientX: 300 });
  Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 7 } });
  fireEvent(svg, event);
  expect(capture).toHaveBeenCalledWith(7);
  fireEvent.keyDown(group, { key: 'ArrowRight' });
  expect(screen.getByText('First')).toBeInTheDocument();
  expect(svg.innerHTML).not.toMatch(/NaN|Infinity/);
});

test('an empty archive displays the empty state without an interactive chart', async () => {
  chart([]);
  expect(await screen.findByText('Analyze games to see your progress.')).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Explore game history' })).toBeNull();
});
