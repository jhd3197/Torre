// /arena — node-limited strength in the seat picker.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { engineEntry, fakeServer, renderAt, STOCKFISH } from '../test/harness';

async function setupPanel() {
  const setup = await screen.findByRole('region', { name: 'Match setup' });
  await waitFor(() => expect(within(setup).getAllByLabelText('Strength')).toHaveLength(2));
  return setup;
}

test('a seat can play by a node budget instead of a rating', async () => {
  const server = fakeServer();
  server.on('api/engines', () => ({ engines: [STOCKFISH, engineEntry('reckless', 'Reckless', { installed: true })] }));
  server.on('api/arena/start', () => ({ running: false, match: null, recent: [] }));
  renderAt('/arena');
  const setup = await setupPanel();
  const first = within(setup).getAllByLabelText('Strength')[0];
  // Stockfish offers ratings and node budgets, the budgets with an approximate rating.
  expect(within(first).getByRole('option', { name: '800 nodes (~1800)' })).toBeInTheDocument();
  fireEvent.change(first, { target: { value: 'n800' } });
  expect(first).toHaveValue('n800');
  // An engine without strength options can still be node-limited.
  const second = within(within(setup).getByRole('region', { name: 'Player 2' }));
  fireEvent.click(second.getByRole('button', { name: 'Change player' }));
  fireEvent.click(screen.getByRole('button', { name: /Reckless/ }));
  expect(second.getByText('Reckless')).toBeInTheDocument();
  const reckless = within(setup).getAllByLabelText('Strength')[1];
  expect(within(reckless).queryByRole('option', { name: 'Plays at 1500' })).toBeNull();
  fireEvent.change(reckless, { target: { value: 'n12800' } });
  fireEvent.click(within(setup).getByRole('button', { name: 'Start match' }));
  await waitFor(() => expect(server.calls.find(c => c.path === 'api/arena/start')?.body).toMatchObject({
    players: [{ engineId: 'stockfish', nodes: 800 }, { engineId: 'reckless', nodes: 12800 }],
  }));
});

test('choosing a rating again drops the node budget', async () => {
  const server = fakeServer();
  server.on('api/arena/start', () => ({ running: false, match: null, recent: [] }));
  renderAt('/arena');
  const setup = await setupPanel();
  const first = within(setup).getAllByLabelText('Strength')[0];
  fireEvent.change(first, { target: { value: 'n200' } });
  fireEvent.change(first, { target: { value: '1800' } });
  fireEvent.click(within(setup).getByRole('button', { name: 'Start match' }));
  await waitFor(() => expect(server.calls.find(c => c.path === 'api/arena/start')?.body).toMatchObject({
    players: [{ engineId: 'stockfish', elo: 1800 }, { engineId: 'stockfish', elo: 2000 }],
  }));
});
