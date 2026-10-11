import { act, renderHook } from '@testing-library/react';
import { bestArrow, createFlag, createLevel, motion, motionReduced, puzzleBlindfold, restoreDefaults, uiSize } from './settings';
import { language } from '../i18n';

test('a flag changed in one place reaches every component already reading it', () => {
  const board = renderHook(() => bestArrow.use());
  expect(board.result.current).toBe(true);
  act(() => bestArrow.set(false));
  expect(board.result.current).toBe(false);
  expect(localStorage.getItem('chess-jd-best-arrow')).toBe('0');
});

test('a value stored under an old key moves to the new one on first read', () => {
  localStorage.setItem('puzzles.blindfold', '1');
  expect(puzzleBlindfold.get()).toBe(true);
  expect(localStorage.getItem('chess-jd-puzzle-blindfold')).toBe('1');
  expect(localStorage.getItem('puzzles.blindfold')).toBeNull();
});

test('a flag ignores a stored value it does not know', () => {
  localStorage.setItem('chess-jd-test-flag', 'yes');
  expect(createFlag('chess-jd-test-flag', true).get()).toBe(true);
});

test('a level stays between 0 and 100, and ignores a stored value it cannot read', () => {
  const level = createLevel('chess-jd-test-level', 40);
  expect(level.get()).toBe(40);
  level.set(130);
  expect(level.get()).toBe(100);
  level.set(-5);
  expect(localStorage.getItem('chess-jd-test-level')).toBe('0');
  localStorage.setItem('chess-jd-test-level-2', 'loud');
  expect(createLevel('chess-jd-test-level-2', 70).get()).toBe(70);
});

test('Reset to defaults puts every setting back, except the language', () => {
  bestArrow.set(false);
  uiSize.set('larger');
  language.set('es');
  restoreDefaults();
  expect(bestArrow.get()).toBe(true);
  expect(uiSize.get()).toBe('normal');
  expect(document.documentElement.dataset.uiSize).toBeUndefined();
  expect(language.get()).toBe('es');
});

test('the motion choice wins over the system, and System asks the system', () => {
  motion.set('reduce');
  expect(motionReduced()).toBe(true);
  expect(document.documentElement.dataset.motion).toBe('reduce');
  motion.set('full');
  expect(motionReduced()).toBe(false);
  motion.set('system');
  expect(document.documentElement.dataset.motion).toBeUndefined();
});
