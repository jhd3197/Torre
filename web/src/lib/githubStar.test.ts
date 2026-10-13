import { cardDue, FIRST_WAIT, markStarred, snooze, SNOOZE, SNOOZE_KEY } from './githubStar';

test('the first visit only starts the clock; the card comes a few days later', () => {
  expect(cardDue(1000)).toBe(false);
  expect(localStorage.getItem(SNOOZE_KEY)).toBe(String(1000 + FIRST_WAIT));
  expect(cardDue(1000 + FIRST_WAIT - 1)).toBe(false);
  expect(cardDue(1000 + FIRST_WAIT)).toBe(true);
});

test('"Not now" puts it away for two weeks, and a star for good', () => {
  cardDue(0);
  snooze(FIRST_WAIT);
  expect(cardDue(FIRST_WAIT + SNOOZE - 1)).toBe(false);
  expect(cardDue(FIRST_WAIT + SNOOZE)).toBe(true);
  markStarred();
  expect(cardDue(FIRST_WAIT * 100)).toBe(false);
});
