import { exportPlay } from './gameExport';
import { loadPlay, savePlay } from './storage';
import { fakeServer, START } from '../test/harness';

test('live download preserves saved timing and uses the correct players and result', async () => {
  const server = fakeServer();
  const report = { format: 'torre-game', version: 1, game: {}, timing: {}, quality: {} };
  server.on('api/export', () => ({ filename: 'game.torre.json', report }));
  const create = vi.fn((_blob: Blob) => 'blob:game');
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = vi.fn(); });
  const clicked: { filename: string; href: string }[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ filename: this.download, href: this.href });
  });
  savePlay({ initialFen: START, moves: [{ uci: 'e2e4', san: 'e4' }], playerColor: 'black', level: 4,
    result: '1-0', resigned: true,
    timings: [{ ply: 1, uci: 'e2e4', elapsed_ms: 1234, source: 'ui_active', partial: true }] });
  await exportPlay(loadPlay()!, 'You', 'Bot');
  expect(server.calls.find(call => call.path === 'api/export')?.body).toMatchObject({
    moves: ['e2e4'], headers: { White: 'Bot', Black: 'You', Result: '1-0', Termination: 'resignation' },
    timings: [{ ply: 1, uci: 'e2e4', elapsed_ms: 1234, source: 'ui_active', partial: true }],
  });
  expect(clicked).toEqual([{ filename: 'game.torre.json', href: 'blob:game' }]);
  expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
  click.mockRestore();
});
