// Event progress, kept in this browser: the event bots you beat while their event was on (you keep
// them, in costume, after it ends) and the crests earned by beating enough of an event's bots.
const EVENTS_KEY = 'chess-jd-events-v1';

export interface EventProgress {
  /** Bot ids beaten during each event, by event id. */
  kept: Record<string, string[]>;
  /** The years each event's crest was earned, by event id. */
  crests: Record<string, number[]>;
}

export function loadEvents(): EventProgress {
  try {
    const saved = JSON.parse(localStorage.getItem(EVENTS_KEY) ?? '{}');
    return { kept: saved?.kept && typeof saved.kept === 'object' ? saved.kept : {}, crests: saved?.crests && typeof saved.crests === 'object' ? saved.crests : {} };
  } catch {
    return { kept: {}, crests: {} };
  }
}

const saveEvents = (progress: EventProgress) => {
  try { localStorage.setItem(EVENTS_KEY, JSON.stringify(progress)); } catch { /* storage unavailable */ }
};

/** Whether `botId` was beaten during `event`, so it stays playable after the event. */
export const isKept = (event: string, botId: string, progress = loadEvents()) => !!progress.kept[event]?.includes(botId);

/**
 * Keep a bot beaten during its event. Returns what changed: whether the bot is newly kept, and
 * whether this win earned the event's crest (beating `need` of its bots, once per year).
 */
export function keepEventBot(event: string, botId: string, need: number, now = Date.now()) {
  const progress = loadEvents();
  const kept = progress.kept[event] ?? [];
  if (kept.includes(botId)) return { kept: false, crest: false, count: kept.length };
  progress.kept[event] = [...kept, botId];
  const year = new Date(now).getFullYear();
  const crest = progress.kept[event].length >= need && !(progress.crests[event] ?? []).includes(year);
  if (crest) progress.crests[event] = [...(progress.crests[event] ?? []), year];
  saveEvents(progress);
  return { kept: true, crest, count: progress.kept[event].length };
}

/** Forget every event's progress (Settings' reset). */
export function clearEvents() {
  try { localStorage.removeItem(EVENTS_KEY); } catch { /* storage unavailable */ }
}
