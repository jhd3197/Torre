// What the coach is saying right now, for the captions strip (Settings → Coach & voice → Captions).
// Each narrator owns the caption it shows, so one narrator ending never clears another's line.
import { useSyncExternalStore } from 'react';
import { createFlag } from './settings';

export const captions = createFlag('chess-jd-captions', false);

let current: { owner: object; text: string } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

export function showCaption(owner: object, text: string) {
  current = text ? { owner, text } : null;
  notify();
}

export function clearCaption(owner: object) {
  if (current?.owner !== owner) return;
  current = null;
  notify();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const text = () => current?.text ?? null;
/** The line being spoken, or null. */
export const useCaption = () => useSyncExternalStore(subscribe, text, text);
