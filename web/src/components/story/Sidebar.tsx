// The Story map's side column: a line of encouragement, story progress, the
// streak week and today's goal. Reads the same profile and stars as the map.
import { useTranslation } from 'react-i18next';
import { FlameIcon, DailyGoal } from './Streak';
import { STORY_ART } from '../../lib/art';
import type { Profile, Streak } from '../../types';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Which days of this week (Mon..Sun) the streak covers, counting back from today. */
export function streakWeek(streak: Streak, today = new Date()): boolean[] {
  const todayIndex = (today.getDay() + 6) % 7;
  const end = streak.doneToday ? todayIndex : todayIndex - 1;
  const start = end - streak.count + 1;
  return DAYS.map((_, i) => i >= start && i <= end);
}

export interface StoryTotals { lessonsDone: number; lessons: number; stars: number; chaptersDone: number; chapters: number }

export function StorySidebar({ profile, totals }: { profile: Profile | null; totals: StoryTotals }) {
  const { t } = useTranslation('story');
  const lines = t('sidebar.lines', { returnObjects: true }) as unknown as string[][];
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000);
  const [line, sub] = lines[dayOfYear % lines.length];
  const share = totals.lessons ? totals.lessonsDone / totals.lessons : 0;
  const streak = profile?.streak;
  return (
    <aside className="story-side" aria-label={t('sidebar.label')}>
      <div className="side-card side-quote">
        <span className="side-quote-mark" aria-hidden="true">“</span>
        <p>{line}</p>
        <small>{sub}</small>
        <img src={STORY_ART.quoteHill} alt="" aria-hidden="true" />
      </div>

      <div className="side-card side-progress">
        <h3>{t('sidebar.title')}</h3>
        <div className="side-bar"><i style={{ width: `${Math.round(share * 100)}%` }} /></div>
        <span className="side-bar-label">{t('sidebar.lessons', { done: totals.lessonsDone, total: totals.lessons })}</span>
        <div className="side-tiles">
          <span><img src="art/stars/star-gold.png" alt="" width="24" height="24" /><b>{profile?.xp ?? 0}</b>{t('sidebar.xpEarned')}</span>
          <span><img src="art/ui3d/reward.webp" alt="" width="24" height="24" /><b>{totals.stars}</b>{t('sidebar.stars')}</span>
          <span><img src={STORY_ART.complete} alt="" width="24" height="24" /><b>{totals.chaptersDone}/{totals.chapters}</b>{t('sidebar.chapters')}</span>
        </div>
      </div>

      {streak && (
        <div className={`side-card side-streak${streak.count > 0 ? ' lit' : ''}`}>
          <div className="side-streak-head">
            <FlameIcon lit={streak.count > 0} size={40} />
            <div>
              <h3>{streak.count > 0 ? t('sidebar.streak', { days: streak.count }) : t('sidebar.startStreak')}</h3>
              <p>{streak.doneToday ? t('sidebar.doneToday') : t('sidebar.meetGoal')}</p>
            </div>
          </div>
          <ol className="side-week">
            {streakWeek(streak).map((on, i) => (
              <li key={DAYS[i]} className={on ? 'on' : ''}><span aria-hidden="true">{on ? '✓' : ''}</span>{t(`sidebar.days.${DAYS[i]}`)}</li>
            ))}
          </ol>
        </div>
      )}

      {streak && (
        <div className="side-card side-goal">
          <DailyGoal streak={streak} />
        </div>
      )}
    </aside>
  );
}
