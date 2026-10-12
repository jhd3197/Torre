// The launch sting: index.html draws it (and decides whether to, on <html data-splash>) before
// any of the app's code loads; this is how the app talks to it once it has. Loading steps post a
// line under the logo while the player waits, and the first page that is ready lifts it.
// Outside an installed app none of this does anything: there is no data-splash.

/** When the sting has finished playing (index.html: the name lands at 1.15 s for 0.6 s). */
const STING_MS = 1800;
/** A step's line only shows once the sting is over and the wait is still going. */
const STATUS_DELAY_MS = 600;
/** However the load goes, the player is never kept behind the splash longer than this. */
const LONGEST_MS = 8000;
const LEAVE_MS = 350;

const showing = () => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-splash');
const splashEl = () => document.getElementById('splash');

let finishing = false;
let statusTimer: ReturnType<typeof setTimeout> | undefined;

/** Says what the app is waiting on ("Getting your games ready"), under the logo. */
export function splashStep(text: string) {
  if (!showing() || finishing) return;
  const line = splashEl()?.querySelector('.splash-status');
  if (!line) return;
  clearTimeout(statusTimer);
  const wait = Math.max(0, STING_MS + STATUS_DELAY_MS - performance.now());
  statusTimer = setTimeout(() => {
    line.textContent = text;
    line.classList.add('on');
  }, wait);
}

/** Lifts the splash, but not before the sting has played out. Safe to call more than once. */
export function splashDone() {
  if (!showing() || finishing) return;
  finishing = true;
  clearTimeout(statusTimer);
  setTimeout(() => {
    splashEl()?.classList.add('leaving');
    setTimeout(() => {
      document.documentElement.removeAttribute('data-splash');
      splashEl()?.remove();
    }, LEAVE_MS);
  }, Math.max(0, STING_MS - performance.now()));
}

// A load that never says it is done (an error page, a route that fails) still lets the player in.
if (showing()) setTimeout(splashDone, Math.max(0, LONGEST_MS - performance.now()));
