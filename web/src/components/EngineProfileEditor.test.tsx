// Settings → Engines: each installed engine's config profile of saved UCI options.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeServer, renderAt } from '../test/harness';

const REPORTED = [
  { name: 'Hash', type: 'spin', default: 16, min: 1, max: 33554432, var: [] },
  { name: 'Threads', type: 'spin', default: 1, min: 1, max: 1024, var: [] },
  { name: 'MultiPV', type: 'spin', default: 1, min: 1, max: 256, var: [] },
  { name: 'Skill Level', type: 'spin', default: 20, min: 0, max: 20, var: [] },
  { name: 'Ponder', type: 'check', default: false, min: null, max: null, var: [] },
  { name: 'Show WDL', type: 'check', default: false, min: null, max: null, var: [] },
  { name: 'Clear Hash', type: 'button', default: null, min: null, max: null, var: [] },
];

function serve(options: Record<string, unknown> = {}) {
  const server = fakeServer();
  let saved = options;
  server.on('api/engines/profile?engineId=stockfish', () => ({ engineId: 'stockfish', options: saved, reported: REPORTED }));
  server.on('api/engines/profile', body => {
    saved = body?.options as Record<string, unknown>;
    return { engineId: 'stockfish', options: saved, profiles: {} };
  });
  server.on('api/engines/profile/delete', () => { saved = {}; return { profiles: {} }; });
  return server;
}

async function openProfile() {
  renderAt('/settings/engines');
  const card = (await screen.findByText('Stockfish')).closest('article')!;
  fireEvent.click(within(card).getByRole('button', { expanded: false }));
  return within(card).findByRole('group', { name: 'Config profile' });
}

test('an installed engine shows its profile with the common options it reports', async () => {
  serve({ Hash: 256 });
  const profile = await openProfile();
  expect(await within(profile).findByLabelText('Hash value')).toHaveValue(256);
  expect(within(profile).getByLabelText('Threads value')).toHaveValue(null);
  expect(within(profile).getByLabelText('Skill Level value')).toBeInTheDocument();
  expect(within(profile).queryByLabelText('Contempt value')).toBeNull(); // Stockfish does not report it
  // The add list holds the rest, without buttons or options the app manages.
  const add = within(profile).getByLabelText('Add an option…');
  expect(within(add).getByRole('option', { name: 'Show WDL' })).toBeInTheDocument();
  expect(within(add).queryByRole('option', { name: 'Clear Hash' })).toBeNull();
  expect(within(add).queryByRole('option', { name: 'Ponder' })).toBeNull();
});

test('saving sends typed values and skips the ones left at the default', async () => {
  const server = serve();
  const profile = await openProfile();
  expect(within(profile).queryByRole('button', { name: 'Clear profile' })).toBeNull();
  fireEvent.change(await within(profile).findByLabelText('Threads value'), { target: { value: '4' } });
  fireEvent.change(within(profile).getByLabelText('Add an option…'), { target: { value: 'Show WDL' } });
  fireEvent.change(within(profile).getByLabelText('Show WDL value'), { target: { value: 'true' } });
  fireEvent.click(within(profile).getByRole('button', { name: 'Save profile' }));
  await waitFor(() => expect(server.calls.find(c => c.path === 'api/engines/profile' && c.body)?.body)
    .toEqual({ engineId: 'stockfish', options: { Threads: 4, 'Show WDL': true } }));
  expect(await within(profile).findByText(/Profile saved/)).toBeInTheDocument();
  fireEvent.click(within(profile).getByRole('button', { name: 'Clear profile' }));
  await waitFor(() => expect(server.calls.some(c => c.path === 'api/engines/profile/delete')).toBe(true));
  await waitFor(() => expect(within(profile).getByLabelText('Threads value')).toHaveValue(null));
});

test('a refused save shows the reason', async () => {
  const server = serve();
  server.on('api/engines/profile', () => { throw new Error('Threads must be from 1 to 1024.'); });
  const profile = await openProfile();
  fireEvent.change(await within(profile).findByLabelText('Threads value'), { target: { value: '5000' } });
  fireEvent.click(within(profile).getByRole('button', { name: 'Save profile' }));
  expect(await within(profile).findByRole('alert')).toHaveTextContent('Threads must be from 1 to 1024.');
});
