// An event's countdown: days, hours, minutes and seconds to `until`, ticking every second.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

/** The time now, updated every `every` ms while mounted. */
export function useNow(every = SECOND) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

/** Whole days from `now` to `until`, as the clock shows them, at least one (for "in 3 days"). */
export const daysUntil = (until: number, now = Date.now()) => Math.max(1, Math.floor((until - now) / DAY));

export function EventClock({ until, label }: { until: number; label: string }) {
  const { t } = useTranslation('play');
  const now = useNow();
  const left = Math.max(0, until - now);
  const parts: [string, string][] = [
    [String(Math.floor(left / DAY)), 'd'], [String(Math.floor(left % DAY / HOUR)).padStart(2, '0'), 'h'],
    [String(Math.floor(left % HOUR / MINUTE)).padStart(2, '0'), 'm'], [String(Math.floor(left % MINUTE / SECOND)).padStart(2, '0'), 's'],
  ];
  return (
    <div className={`event-clock${left < DAY ? ' urgent' : ''}`} role="timer"
      aria-label={`${label} ${t('bots.clock.spoken', { d: parts[0][0], h: Number(parts[1][0]), m: Number(parts[2][0]) })}`}>
      <span className="event-clock-label" aria-hidden>{label}</span>
      <span className="event-clock-parts" aria-hidden>
        {parts.map(([value, unit]) => <span key={unit}><b>{value}</b><small>{t(`bots.clock.${unit}`)}</small></span>)}
      </span>
    </div>
  );
}
