// "Star Torre on GitHub": a star beside the logo in the rail, and now and then a short card
// asking for one. Clicking through hides the card for good; "Not now" puts it away for two weeks.
// A newcomer's first visit only starts the clock, so the card waits until they have played a while.
export const REPO_URL = 'https://github.com/jhd3197/Torre';
export const STARRED_KEY = 'torre.githubStar.starred';
export const SNOOZE_KEY = 'torre.githubStar.snoozedUntil';
const DAY = 24 * 60 * 60 * 1000;
export const FIRST_WAIT = 3 * DAY;
export const SNOOZE = 14 * DAY;

function get(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function set(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: the card stays away */ }
}

/** Whether the card shows now. Without storage it never does, since it could not stay dismissed. */
export function cardDue(now = Date.now()): boolean {
  if (get(STARRED_KEY) === '1') return false;
  const until = Number(get(SNOOZE_KEY));
  if (!until) {
    set(SNOOZE_KEY, String(now + FIRST_WAIT));
    return false;
  }
  return now >= until;
}

export const markStarred = () => set(STARRED_KEY, '1');
export const snooze = (now = Date.now()) => set(SNOOZE_KEY, String(now + SNOOZE));
