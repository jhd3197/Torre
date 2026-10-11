import { moveSound } from './useSounds';

test('each move makes its own sound, read from its SAN', () => {
  expect(['e4', 'Nxe5', 'Qh5+', 'Qxf7#', 'O-O', 'O-O-O+', 'e8=Q', 'exd8=N', undefined].map(moveSound))
    .toEqual(['move', 'capture', 'check', 'check', 'castle', 'check', 'promote', 'promote', 'move']);
});
