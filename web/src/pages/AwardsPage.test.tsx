import { fireEvent, screen } from '@testing-library/react';
import { fakeServer, renderAt } from '../test/harness';

const award = (id: string, family: string, count: number, level: number, tier: string, next: number | null) =>
  ({ id, family, title: id[0].toUpperCase() + id.slice(1), description: `About ${id}`, unit: 'times', thresholds: [10, 100, 400, 1000], count, level, tier, next });

test('awards show their tier and progress, and open their thresholds', async () => {
  const server = fakeServer();
  server.on('api/achievements', () => ({ awards: [
    award('fork', 'tactics', 120, 2, 'bronze', 400),
    award('pin', 'tactics', 3, 0, 'locked', 10),
    award('legend', 'milestones', 1200, 4, 'gold', null),
  ] }));
  renderAt('/awards');
  expect(await screen.findByRole('heading', { name: '2 of 3 awards earned' })).toBeInTheDocument();
  expect(screen.getByText('120 / 400 times')).toBeInTheDocument();
  expect(screen.getByText('3 / 10 times')).toBeInTheDocument();
  expect(screen.getByText('1,200 times · maxed')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Fork/ }));
  expect(screen.getByText('About fork.')).toBeInTheDocument();
  expect(screen.getByText('400 times')).toBeInTheDocument();
});
