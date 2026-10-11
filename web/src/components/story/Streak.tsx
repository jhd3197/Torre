// Streak UI: the flame chip for the focus-mode header and the daily-goal ring
// for the story map. Both read the same `streak` field of GET /api/profile.
import { useTranslation } from 'react-i18next';
import type { Streak } from '../../types';

/** The little flame, tinted with currentColor so its parent can light it.
 *  `lit` toggles the shared .flame styles (profile.css); chip contexts override
 *  the tint with their own CSS (.streak-chip svg). */
export function FlameIcon({ lit = true, size = 12 }: { lit?: boolean; size?: number }) {
  return (
    <svg className={`flame${lit ? ' lit' : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62.9-2.65 2.28-3.51-.09.9.32 1.79 1.13 2.22.6-.75 1.1-1.7 1.28-2.78 1.5 1.04 2.45 2.6 2.45 4.07 0 1.74-1.44 3.14-3.22 3.14h-.7z" />
    </svg>
  );
}

/** Focus-mode header chip: the streak count beside a flame that stays unlit
 *  until today's goal is met. */
export function StreakChip({ streak }: { streak: Streak }) {
  const { t } = useTranslation('story');
  return (
    <span className={`streak-chip${streak.doneToday ? ' lit' : ''}`}
      title={[t('streak.chipTitle', { days: streak.count, xp: streak.xpToday, goal: streak.goal }),
        streak.freezes ? t('streak.freezes', { count: streak.freezes }) : ''].filter(Boolean).join(' ')}>
      <FlameIcon lit={streak.doneToday} />{streak.count}
      {!!streak.freezes && <span className="streak-freezes" aria-label={t('streak.freezes', { count: streak.freezes })}>❄{streak.freezes}</span>}
    </span>
  );
}

/** Story-map header element: a small ring filling toward today's XP goal. */
export function DailyGoal({ streak }: { streak: Streak }) {
  const { t } = useTranslation('story');
  const ratio = streak.goal > 0 ? Math.min(1, streak.xpToday / streak.goal) : 0;
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  return (
    <span className={`daily-goal${streak.doneToday ? ' done' : ''}`}
      title={t('streak.goalTitle', { xp: streak.xpToday, goal: streak.goal })}>
      <svg className="daily-goal-ring" width="24" height="24" viewBox="0 0 24 24"
        role="img" aria-label={t('streak.goalLabel', { xp: streak.xpToday, goal: streak.goal })}>
        <circle className="daily-goal-track" cx="12" cy="12" r={radius} />
        <circle className="daily-goal-fill" cx="12" cy="12" r={radius}
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} />
        {streak.doneToday && <path className="daily-goal-check" d="M8.6 12.3l2.3 2.3 4.5-4.6" />}
      </svg>
      <span>{t('streak.goal', { xp: streak.xpToday, goal: streak.goal })}</span>
    </span>
  );
}
