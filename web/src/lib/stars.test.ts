import { loadStars, recordStars, starCount, starGoals } from './stars';

test('a game earns a star for playing it out, for not losing, and for winning', () => {
  expect(starCount(starGoals('1-0', 'white', 12))).toBe(3);
  expect(starCount(starGoals('1/2-1/2', 'black', 8))).toBe(2);
  expect(starCount(starGoals('1-0', 'black', 25))).toBe(1);
  expect(starCount(starGoals('1-0', 'black', 10))).toBe(0);
});

test('only an improvement is recorded', () => {
  expect(recordStars('pip-pawnworth', 2)).toBe(true);
  expect(recordStars('pip-pawnworth', 1)).toBe(false);
  expect(recordStars('pip-pawnworth', 3)).toBe(true);
  expect(loadStars()).toEqual({ 'pip-pawnworth': 3 });
});
