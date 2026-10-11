import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { explorePath } from '../lib/routes';
import { engineEntry, fakeServer, renderAt, STOCKFISH } from '../test/harness';

const SAN: Record<string, string> = { e2e4: 'e4', e7e5: 'e5', g1f3: 'Nf3', g8f6: 'Nf6', d2d4: 'd4' };

function serve() {
  const server = fakeServer();
  server.on('api/line', body => ({ moves: (body?.moves as string[]).map(uci => ({ uci, san: SAN[uci] ?? uci })) }));
  server.on('api/move', body => ({ san: SAN[String(body?.move)] ?? body?.move, uci: body?.move, result: null }));
  return server;
}

test('the exploration lives in the URL and survives a reload', async () => {
  serve();
  const path = explorePath({ moves: ['e2e4', 'e7e5'], base: 2, from: '/games/5/2', flipped: true });
  renderAt(path);
  expect(await screen.findByRole('button', { name: /Go to move 1, e5/ })).toHaveAttribute('aria-current', 'step');
  expect(screen.getByRole('link', { name: 'Back to replay ↩' })).toHaveAttribute('href', '/games/5/2');
  expect(screen.getByRole('button', { name: 'Reset line ↩' })).toBeDisabled();
});

test('moves extend the URL; Reset line returns to the source line', async () => {
  serve();
  const { location } = renderAt(explorePath({ moves: ['e2e4', 'e7e5'], base: 2, from: '/play' }));
  const target = await screen.findByRole('button', { name: 'White knight on g1' });
  await act(async () => { fireEvent.click(target); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Empty f3' })); });
  await waitFor(() => expect(new URLSearchParams(location().search).get('moves')).toBe('e2e4,e7e5,g1f3'));
  expect(screen.getByRole('link', { name: 'Back to game ↩' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Reset line ↩' }));
  await waitFor(() => expect(new URLSearchParams(location().search).get('moves')).toBe('e2e4,e7e5'));
});

test('an illegal move in a shared link is cut, with an explanation', async () => {
  const server = serve();
  server.on('api/line', () => ({ moves: [{ uci: 'e2e4', san: 'e4' }], error: 'This line contains an illegal move. It was cut at the last legal one.' }));
  renderAt('/explore?moves=e2e4,e2e5');
  expect(await screen.findByText(/cut at the last legal one/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Go to move 1, e4/ })).toBeInTheDocument();
});

test('square control shows who attacks a square', async () => {
  const server = serve();
  server.on('api/position', () => ({
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', turn: 'white', pieces: { e1: 'K', e8: 'k' }, legal: ['e1e2'], check: null,
    result: null, termination: null, plans: {}, control: { e2: { white: ['e1'], black: [] }, d7: { white: [], black: ['e8'] } },
  }));
  renderAt('/explore?fen=4k3%2F8%2F8%2F8%2F8%2F8%2F8%2F4K3+w+-+-+0+1');
  const e2 = await screen.findByRole('button', { name: 'Empty e2' });
  expect(e2).toHaveAttribute('data-heat', 'white');
  expect(screen.getByRole('button', { name: 'Empty d7' })).toHaveAttribute('data-heat', 'black');
  fireEvent.click(screen.getByRole('button', { name: /Square control/ }));
  expect(e2).not.toHaveAttribute('data-heat');
});

test('the engine panel picks the analysis engine and sends it with the request', async () => {
  const server = serve();
  server.on('api/engines', () => ({ engines: [STOCKFISH, engineEntry('lc0', 'Leela Chess Zero', { installed: true, type: 'neural' })] }));
  renderAt('/explore');
  const picker = await screen.findByRole('combobox', { name: 'Analysis engine' });
  await waitFor(() => expect(server.calls.filter(c => c.path === 'api/engine').at(-1)?.body).toMatchObject({ engineId: 'stockfish' }));
  fireEvent.change(picker, { target: { value: 'lc0' } });
  await waitFor(() => expect(server.calls.filter(c => c.path === 'api/engine').at(-1)?.body).toMatchObject({ engineId: 'lc0' }));
  expect(localStorage.getItem('chess-jd-analysis-engine')).toBe('lc0');
});
