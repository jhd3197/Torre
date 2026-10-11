import { fireEvent, screen, within } from '@testing-library/react';
import { fakeServer, renderAt } from '../test/harness';
import { rangeStart, type ImportStatus } from './ImportPage';

const idle: ImportStatus = {
  phase: 'idle', source: null, username: null, done: 0, total: 0, label: null, error: null,
  games: [], failed: [], added: 0, duplicates: 0,
};
const games = [
  { id: '11', date: '2026.09.20', opponent: 'Rival', user_color: 'white' as const, user_result: 1, plies: 40, exists: false },
  { id: '12', date: '2026.09.19', opponent: 'Old friend', user_color: 'black' as const, user_result: 0, plies: 31, exists: true },
];

test('a range starts that many days back; all time has no start', () => {
  const today = new Date('2026-10-05T12:00:00Z');
  expect(rangeStart('month', today)).toBe('2026-09-04');
  expect(rangeStart('all', today)).toBeNull();
});

test('chess.com: fetch, preview with new games ticked, import, then offer analysis', async () => {
  const server = fakeServer();
  let status: ImportStatus = idle;
  server.on('api/import/status', () => status);
  server.on('api/setup', () => ({ onboarded: true, accounts: { chesscom: 'jhd3197', lichess: null } }));
  server.on('api/import/fetch', () => {
    status = { ...idle, phase: 'ready', source: 'chesscom', username: 'jhd3197', games,
      failed: [{ where: '#3', white: 'A', black: 'B', error: 'Neither player is you.' }] };
    return status;
  });
  server.on('api/import/commit', () => ({ ...status, phase: 'done', added: 1, duplicates: 0 }));
  renderAt('/import');

  const username = await screen.findByLabelText('Your Chess.com username');
  expect(await screen.findByDisplayValue('jhd3197')).toBe(username);
  fireEvent.click(screen.getByRole('button', { name: 'All time' }));
  fireEvent.click(screen.getByRole('button', { name: 'Find games' }));

  expect(await screen.findByRole('heading', { name: '2 games found' })).toBeInTheDocument();
  const fetch = server.calls.find(c => c.path === 'api/import/fetch');
  expect(fetch?.body).toEqual({ source: 'chesscom', username: 'jhd3197', since: null });
  expect(screen.getByRole('checkbox', { name: /Rival/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /Old friend/ })).not.toBeChecked();
  expect(screen.getByText('In library')).toBeInTheDocument();
  expect(screen.getByText('1 game could not be read')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Import 1 game' }));
  expect(await screen.findByRole('heading', { name: '1 game added to your library' })).toBeInTheDocument();
  expect(server.calls.find(c => c.path === 'api/import/commit')?.body).toEqual({ ids: ['11'] });
  expect(screen.getByRole('button', { name: 'Analyse new games' })).toBeEnabled();
  expect(screen.getByRole('link', { name: 'Open games' })).toHaveAttribute('href', '/games');
});

test('files: asks which player you are when no name is yours', async () => {
  const server = fakeServer();
  server.on('api/import/status', () => idle);
  server.on('api/import/files', body => body?.me
    ? { ...idle, phase: 'ready', source: 'file', games }
    : { ...idle, phase: 'choose', players: [{ name: 'Magnus', games: 3 }, { name: 'Hikaru', games: 1 }] });
  renderAt('/import');

  fireEvent.click(await screen.findByRole('radio', { name: /PGN file/ }));
  fireEvent.change(screen.getByLabelText('PGN game notation'), { target: { value: '[White "Magnus"]\n\n1. e4 *' } });
  fireEvent.click(screen.getByRole('button', { name: 'Read games' }));

  const players = await screen.findByRole('radiogroup', { name: 'Which player are you?' });
  fireEvent.click(within(players).getByRole('radio', { name: /Magnus/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByRole('heading', { name: '2 games found' })).toBeInTheDocument();
  const sent = server.calls.filter(c => c.path === 'api/import/files');
  expect(sent[1].body).toEqual({ files: [{ name: 'pasted.pgn', text: '[White "Magnus"]\n\n1. e4 *' }], me: 'Magnus' });
});

test('a fetch in progress shows the month being read and can be cancelled', async () => {
  const server = fakeServer();
  let status: ImportStatus = { ...idle, phase: 'fetching', source: 'lichess', username: 'someone', done: 0, total: 0 };
  server.on('api/import/status', () => status);
  server.on('api/import/cancel', () => { status = idle; return status; });
  renderAt('/import');
  expect(await screen.findByRole('heading', { name: "Finding someone's games on Lichess" })).toBeInTheDocument();
  expect(screen.getByText('0 games so far')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByRole('radio', { name: /Lichess/ })).toHaveAttribute('aria-checked', 'true');
});

test('an unknown account shows the server message', async () => {
  const server = fakeServer();
  server.on('api/import/status', () => idle);
  server.on('api/import/fetch', () => { throw new Error('There is no chess.com player with that username.'); });
  renderAt('/import');
  fireEvent.change(await screen.findByLabelText('Your Chess.com username'), { target: { value: 'nobody' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find games' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('There is no chess.com player with that username.');
});
