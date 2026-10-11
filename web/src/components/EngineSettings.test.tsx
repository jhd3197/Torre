// Settings → Engines (the old Engine Lab): sections, rows, installing, custom engines and the analysis engine.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { engineEntry, fakeServer, renderAt, STOCKFISH } from '../test/harness';

function serveLab() {
  const server = fakeServer();
  server.on('api/engines', () => ({
    engines: [
      STOCKFISH,
      engineEntry('reckless', 'Reckless', { description: 'A top NNUE engine with an aggressive search style.' }),
      engineEntry('lc0', 'Leela Chess Zero', {
        type: 'neural', strength_ccrl: 3600,
        models: [
          { id: 'maia-1100', name: 'Maia 1100', weights: 'maia-1100.pb.gz', installed: false, rating_target: 1100, style: 'human' },
          { id: 'maia-1500', name: 'Maia 1500', weights: 'maia-1500.pb.gz', installed: false, rating_target: 1500, style: 'human' },
        ],
      }),
    ],
  }));
  return server;
}

test('the lab groups engines into installed and available', async () => {
  serveLab();
  renderAt('/settings/engines');
  const installed = await screen.findByRole('region', { name: 'Installed' });
  expect(within(installed).getByText('Stockfish')).toBeInTheDocument();
  expect(within(installed).queryByText('Reckless')).toBeNull();
  const available = screen.getByRole('region', { name: 'Available' });
  expect(within(available).getByText('Reckless')).toBeInTheDocument();
  expect(within(available).getByText('Leela Chess Zero')).toBeInTheDocument();
});

test('an installed engine offers Play and Uninstall, an available one Install', async () => {
  serveLab();
  renderAt('/settings/engines');
  const installed = await screen.findByRole('region', { name: 'Installed' });
  expect(within(installed).getByRole('button', { name: 'Play' })).toBeEnabled();
  expect(within(installed).queryByRole('button', { name: 'Uninstall' })).toBeNull(); // Stockfish stays
  const available = screen.getByRole('region', { name: 'Available' });
  for (const button of within(available).getAllByRole('button', { name: 'Install' })) {
    expect(button).toBeEnabled();
  }
});

test('clicking a card expands its capabilities, rating and models', async () => {
  serveLab();
  renderAt('/settings/engines');
  const card = (await screen.findByText('Leela Chess Zero')).closest('article')!;
  fireEvent.click(within(card).getByRole('button', { expanded: false }));
  expect(await within(card).findByText('Maia 1100')).toBeInTheDocument();
  expect(within(card).getByText('plays like ~1100')).toBeInTheDocument();
  // Lc0 itself is not installed, so the models cannot be installed yet.
  expect(within(card).getAllByTitle('Install Leela Chess Zero first')).toHaveLength(2);
  expect(within(card).getByText('Elo limiting')).toBeInTheDocument();
  expect(within(card).getByText('Neural')).toBeInTheDocument();
  // The repo link points at the engine's source.
  expect(within(card).getByRole('link', { name: 'Source code' })).toHaveAttribute('href', 'https://github.com/official-stockfish/Stockfish');
});

test('installing a Maia model runs its own download and marks it installed', async () => {
  const server = fakeServer();
  let installed = false;
  const maia = () => ({ id: 'maia-1500', name: 'Maia 1500', weights: 'maia-1500.pb.gz', installed, rating_target: 1500, style: 'human', download: { url: 'https://example.com/maia-1500.pb.gz', size: 1258199, sha256: null } });
  server.on('api/engines', () => ({ engines: [STOCKFISH, engineEntry('lc0', 'Leela Chess Zero', { installed: true, type: 'neural', models: [maia()] })] }));
  server.on('api/engines/models/install', body => {
    if (body) { installed = true; return { running: true, engine_id: 'lc0', model_id: body.modelId, phase: 'download', downloaded: 629099, total: 1258199, error: null }; }
    return { running: false, engine_id: 'lc0', model_id: 'maia-1500', phase: 'done', downloaded: 1258199, total: 1258199, error: null };
  });
  server.on('api/engines/install', () => ({ running: false, engine_id: 'lc0', model_id: 'maia-1500', phase: 'done', downloaded: 1258199, total: 1258199, error: null }));
  renderAt('/settings/engines');
  // Installed alongside Stockfish, Lc0 is also offered as the analysis engine; its row is the article.
  const card = (await screen.findByText('Leela Chess Zero', { selector: '.engine-row strong' })).closest('article')!;
  fireEvent.click(within(card).getByRole('button', { expanded: false }));
  fireEvent.click(await within(card).findByRole('button', { name: 'Install' }));
  expect(await within(card).findByText('Downloading… 50%')).toBeInTheDocument();
  await waitFor(() => expect(within(card).getByText('installed')).toBeInTheDocument());
  // The card-level Uninstall for Lc0, plus the model's own.
  expect(within(card).getAllByRole('button', { name: 'Uninstall' })).toHaveLength(2);
}, 15000);

test('Play on Stockfish opens the lobby with its bot selected', async () => {
  serveLab();
  const { location } = renderAt('/settings/engines');
  const installed = await screen.findByRole('region', { name: 'Installed' });
  fireEvent.click(within(installed).getByRole('button', { name: 'Play' }));
  await act(async () => {});
  expect(location().pathname).toBe('/play/bots/engines');
  expect(location().search).toBe('?bot=sf18');
});

test('installing an engine shows progress and the engine joins Installed', async () => {
  const server = fakeServer();
  const berserk = engineEntry('berserk', 'Berserk');
  let done = false;
  server.on('api/engines', () => ({ engines: [STOCKFISH, done ? { ...berserk, installed: true } : berserk] }));
  server.on('api/engines/install', body => {
    if (body) { done = true; return { running: true, engine_id: body.engineId, phase: 'download', downloaded: 524288, total: 1048576, error: null }; }
    return { running: false, engine_id: 'berserk', phase: 'done', downloaded: 1048576, total: 1048576, error: null };
  });
  renderAt('/settings/engines');
  const available = await screen.findByRole('region', { name: 'Available' });
  fireEvent.click(within(available).getByRole('button', { name: 'Install' }));
  expect(await screen.findByText('Downloading… 50%')).toBeInTheDocument();
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Installed' })).getByText('Berserk')).toBeInTheDocument());
}, 15000);

test('a failed install shows the error on the card', async () => {
  const server = fakeServer();
  server.on('api/engines', () => ({ engines: [STOCKFISH, engineEntry('berserk', 'Berserk')] }));
  server.on('api/engines/install', body => {
    if (body) return { running: false, engine_id: 'berserk', phase: null, downloaded: 0, total: 0, error: 'The download did not match its size.' };
    return { running: false, engine_id: 'berserk', phase: null, downloaded: 0, total: 0, error: 'The download did not match its size.' };
  });
  renderAt('/settings/engines');
  const available = await screen.findByRole('region', { name: 'Available' });
  fireEvent.click(within(available).getByRole('button', { name: 'Install' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/did not match its size/);
});

test('uninstalling asks for confirmation and removes the engine', async () => {
  const server = fakeServer();
  let present = true;
  server.on('api/engines', () => ({ engines: [STOCKFISH, ...(present ? [engineEntry('berserk', 'Berserk', { installed: true })] : [])] }));
  server.on('api/engines/uninstall', () => { present = false; return { engines: [] }; });
  renderAt('/settings/engines');
  const installed = await screen.findByRole('region', { name: 'Installed' });
  fireEvent.click(within(installed).getByRole('button', { name: 'Uninstall' }));
  fireEvent.click(within(installed).getByRole('button', { name: 'Uninstall it?' }));
  await waitFor(() => expect(within(installed).queryByText('Berserk')).toBeNull());
});

test('a custom engine is added through the form and removed from its card', async () => {
  const server = fakeServer();
  let added = false;
  const custom = { ...STOCKFISH, id: 'my-stockfish', name: 'My Stockfish', custom: true, type: 'custom', download: null };
  server.on('api/engines', () => ({ engines: [STOCKFISH, ...(added ? [custom] : [])] }));
  server.on('api/engines/custom', () => { added = true; return { engine: custom, engines: [] }; });
  server.on('api/engines/custom/delete', () => { added = false; return { engines: [] }; });
  renderAt('/settings/engines');
  const section = await screen.findByRole('region', { name: 'Custom' });
  fireEvent.change(within(section).getByLabelText('Engine name'), { target: { value: 'My Stockfish' } });
  fireEvent.change(within(section).getByLabelText('Path to the binary'), { target: { value: 'C:/engines/sf.exe' } });
  fireEvent.click(within(section).getByRole('button', { name: 'Add engine' }));
  await waitFor(() => expect(within(section).getByText('My Stockfish')).toBeInTheDocument());
  expect(server.calls.find(c => c.path === 'api/engines/custom')?.body).toMatchObject({ name: 'My Stockfish', path: 'C:/engines/sf.exe' });
  fireEvent.click(within(section).getByRole('button', { name: 'Remove' }));
  fireEvent.click(within(section).getByRole('button', { name: 'Remove it?' }));
  await waitFor(() => expect(within(section).queryByText('My Stockfish')).toBeNull());
});

test('a custom engine that fails the probe shows the error', async () => {
  const server = fakeServer();
  server.on('api/engines/custom', () => { throw new Error('nope.exe did not answer the UCI handshake; is it a chess engine?'); });
  renderAt('/settings/engines');
  const section = await screen.findByRole('region', { name: 'Custom' });
  fireEvent.change(within(section).getByLabelText('Engine name'), { target: { value: 'Nope' } });
  fireEvent.change(within(section).getByLabelText('Path to the binary'), { target: { value: 'C:/nope.exe' } });
  fireEvent.click(within(section).getByRole('button', { name: 'Add engine' }));
  expect(await within(section).findByRole('alert')).toHaveTextContent(/did not answer/);
});

test('/engines lands on the Engines section of Settings', async () => {
  serveLab();
  const { location } = renderAt('/engines');
  await waitFor(() => expect(location().pathname).toBe('/settings/engines'));
  const section = await screen.findByRole('region', { name: 'Engines' });
  expect(within(section).getByRole('region', { name: 'Installed' })).toBeInTheDocument();
});

test('with two engines installed, the analysis engine is chosen under Analysis', async () => {
  const server = fakeServer();
  server.on('api/engines', () => ({ engines: [STOCKFISH, engineEntry('berserk', 'Berserk', { installed: true })] }));
  renderAt('/settings/analysis');
  const choice = await screen.findByRole('combobox', { name: 'Analysis engine' });
  expect(choice).toHaveValue('stockfish');
  fireEvent.change(choice, { target: { value: 'berserk' } });
  expect(localStorage.getItem('chess-jd-analysis-engine')).toBe('berserk');
});
