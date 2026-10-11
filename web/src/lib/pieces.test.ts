import { act, renderHook } from '@testing-library/react';
import { figureSrc, pieceSrc, resetPieceSet, setPieceSet, usePieceSet } from './pieces';

afterEach(resetPieceSet);

test('classic pieces are the SVGs the studio serves', () => {
  expect(pieceSrc('K', 'classic')).toBe('pieces/K.svg');
  expect(pieceSrc('n', 'classic')).toBe('pieces/n.svg');
});

test('clay pieces carry a colour prefix, so K and k never share a file name', () => {
  expect(pieceSrc('K', 'clay')).toBe('art/pieces/board/wK.webp');
  expect(pieceSrc('k', 'clay')).toBe('art/pieces/board/bK.webp');
  expect(pieceSrc('p', 'clay')).toBe('art/pieces/board/bP.webp');
  expect(pieceSrc('N', 'staunton')).toBe('art/pieces/staunton/wN.webp');
  expect(pieceSrc('q', 'staunton')).toBe('art/pieces/staunton/bQ.webp');
});

test('the Staunton pieces are the default, and a change reaches every board and is remembered', () => {
  const { result } = renderHook(() => usePieceSet());
  expect(result.current).toBe('staunton');
  act(() => setPieceSet('classic'));
  expect(result.current).toBe('classic');
  expect(localStorage.getItem('chess-jd-piece-set')).toBe('classic');
  resetPieceSet();
  expect(renderHook(() => usePieceSet()).result.current).toBe('classic');
});

test('an unknown saved value falls back to the Staunton pieces', () => {
  localStorage.setItem('chess-jd-piece-set', 'wooden');
  expect(renderHook(() => usePieceSet()).result.current).toBe('staunton');
});

test('figure art paths', () => {
  expect(figureSrc('black', 'resigned')).toBe('art/pieces/black-resigned.webp');
});
