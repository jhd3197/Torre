import { act, renderHook } from '@testing-library/react';
import { useMoveTiming } from './useMoveTiming';

test('resumed turns are partial; new turns exclude bot time and API latency', () => {
  let now = 100;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const { result, rerender } = renderHook(({ ply, enabled }) => useMoveTiming('game', ply, enabled),
    { initialProps: { ply: 2, enabled: true } });
  now = 1100;
  expect(result.current('g1f3')).toMatchObject({ ply: 3, elapsed_ms: 1000, partial: true });
  rerender({ ply: 3, enabled: false });
  now = 8000;
  expect(result.current('b8c6')).toBeNull();
  rerender({ ply: 4, enabled: true });
  now = 10500;
  const submitted = result.current('f1b5');
  rerender({ ply: 4, enabled: false });
  now = 20000;
  expect(submitted).toMatchObject({ ply: 5, elapsed_ms: 2500, partial: false });
  clock.mockRestore();
});

test('hidden tabs and replay pause timing and mark the observation partial', () => {
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const { result, rerender } = renderHook(({ ply, enabled }) => useMoveTiming('game', ply, enabled),
    { initialProps: { ply: 0, enabled: false } });
  rerender({ ply: 2, enabled: true });
  now = 1000;
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  now = 9000;
  visibility.mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  now = 11000;
  rerender({ ply: 2, enabled: false });
  now = 20000;
  rerender({ ply: 2, enabled: true });
  now = 20500;
  expect(result.current('g1f3')).toMatchObject({ elapsed_ms: 3500, partial: true });
  clock.mockRestore();
  visibility.mockRestore();
});
