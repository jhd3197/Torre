import { useEffect, useRef } from 'react';

export interface MoveTiming {
  ply: number;
  uci: string;
  elapsed_ms: number;
  source: 'ui_active';
  partial: boolean;
}

/** Active time until move submission. Hidden tabs/replay pause the observation.
 * The first turn after mounting/resuming is partial: its true start is unknown. */
export function useMoveTiming(session: string, ply: number, enabled: boolean) {
  const timer = useRef({ session, ply, elapsed: 0, start: null as number | null, partial: true, observed: false });
  useEffect(() => {
    const old = timer.current;
    if (old.session !== session || old.ply !== ply) {
      timer.current = { session, ply, elapsed: 0, start: null, partial: old.session !== session, observed: false };
    }
    const tick = timer.current;
    function pause() {
      if (tick.start !== null) { tick.elapsed += performance.now() - tick.start; tick.start = null; }
    }
    function sync() {
      if (enabled && document.visibilityState !== 'hidden') {
        tick.start ??= performance.now();
        tick.observed = true;
      } else {
        pause();
        if (tick.observed || enabled) tick.partial = true;
      }
    }
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => { pause(); document.removeEventListener('visibilitychange', sync); };
  }, [session, ply, enabled]);

  return (uci: string): MoveTiming | null => {
    const tick = timer.current;
    if (tick.session !== session || tick.ply !== ply || !tick.observed) return null;
    return { ply: ply + 1, uci, source: 'ui_active', partial: tick.partial,
      elapsed_ms: Math.max(0, Math.round(tick.elapsed + (tick.start === null ? 0 : performance.now() - tick.start))) };
  };
}
