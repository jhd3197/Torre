// Cinema mode: autoplay plus narration, shared by the transport bar and the step views.
import { useEffect, useEffectEvent, useRef } from 'react';
import type { Narration } from '../../hooks/useNarration';

export const REPLY_DELAY = 500;
export const DEMO_PLY_DELAY = 1100;
/** How long a step waits after its last beat before the lesson carries on by itself. */
export const AUTO_ADVANCE_DELAY = 900;

export interface Cinema {
  slug: string;
  autoplay: boolean;
  speaking: boolean;
  speak: (request: Narration | null, onEnd?: () => void) => void;
  stop: () => void;
}

/**
 * A step's autoplay opening: runs `start` when the step arrives with autoplay on, and again each
 * time autoplay is switched back on; `pause` runs while it is off. `start` may return a cleanup,
 * which runs if autoplay stops or the step goes away first.
 */
export function useAutoplayStart(autoplay: boolean, start: () => void | (() => void), pause?: () => void) {
  const startedRef = useRef(false);
  const onStart = useEffectEvent(start);
  const onPause = useEffectEvent(() => pause?.());
  useEffect(() => {
    if (!autoplay) { startedRef.current = false; onPause(); return; }
    if (startedRef.current) return;
    startedRef.current = true;
    const cleanup = onStart();
    if (!cleanup) return;
    // Cancelled before it finished: the next run (StrictMode's remount included) starts over.
    return () => { startedRef.current = false; cleanup(); };
  }, [autoplay]);
}

/** Once `when` holds, a beat later the lesson carries on (unless `when` lapses first). */
export function useContinueAfter(when: boolean, onContinue: () => void, delay = AUTO_ADVANCE_DELAY) {
  const carryOn = useEffectEvent(onContinue);
  useEffect(() => {
    if (!when) return;
    const timer = setTimeout(() => carryOn(), delay);
    return () => clearTimeout(timer);
  }, [when, delay]);
}

/** Once `when` holds, the coach says the line, then a beat after it ends the lesson carries on.
 *  If `when` lapses (autoplay stops) or the step goes away first, the lesson does not move on. */
export function useSpeakThenContinue(when: boolean, speak: Cinema['speak'], line: string, onContinue: () => void) {
  const carryOn = useEffectEvent(onContinue);
  const say = useEffectEvent((onEnd: () => void) => speak({ narration: line }, onEnd));
  useEffect(() => {
    if (!when) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    say(() => {
      if (!cancelled) timer = setTimeout(() => carryOn(), AUTO_ADVANCE_DELAY);
    });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [when]);
}
