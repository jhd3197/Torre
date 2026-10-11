// One self-rescheduling poll per component: a later schedule replaces the pending one, and unmounting
// stops it for good, including a request still in flight that would otherwise schedule the next tick.
import { useCallback, useEffect, useRef } from 'react';

export function usePoll() {
  const state = useRef({ timer: undefined as ReturnType<typeof setTimeout> | undefined, controller: new AbortController() });

  useEffect(() => {
    const current = state.current;
    // A remount (StrictMode's included) polls again with a live signal.
    if (current.controller.signal.aborted) current.controller = new AbortController();
    return () => { clearTimeout(current.timer); current.controller.abort(); };
  }, []);

  /** Runs `tick` after `ms`, unless the component is gone by then. */
  const schedule = useCallback((tick: () => void, ms: number) => {
    const current = state.current;
    clearTimeout(current.timer);
    if (!current.controller.signal.aborted) current.timer = setTimeout(tick, ms);
  }, []);
  /** Drops the pending tick. */
  const cancel = useCallback(() => clearTimeout(state.current.timer), []);
  /** Aborted on unmount: pass it to the request, and check it before acting on the answer. */
  const signal = useCallback(() => state.current.controller.signal, []);

  return { schedule, cancel, signal };
}
