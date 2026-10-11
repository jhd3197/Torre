// The day's "fix your mistakes" plan from /api/today: drills from your games, missed puzzles due for a
// retry, and a few new puzzles mined from your games. Each step links to where it is done.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PROGRESS_ART } from '../lib/art';
import { api } from '../lib/api';
import { PUZZLE_MISSED, puzzlePath } from '../lib/routes';
import type { TodayPlan as Plan } from '../types';

const MINE_THEME = 'from-your-games';

export function useTodayPlan(refreshKey?: unknown) {
  const [plan, setPlan] = useState<Plan | null>(null);
  useEffect(() => {
    let live = true;
    api<Plan>('api/today').then(p => { if (live) setPlan(p); }, () => { /* the plan stays hidden */ });
    return () => { live = false; };
  }, [refreshKey]);
  return plan;
}

/** The plan as three steps; `here` marks the drills step as the current page (no link). */
export function TodayPlan({ plan, here = false }: { plan: Plan; here?: boolean }) {
  const { t } = useTranslation('train');
  const drills = plan.drills.due + plan.drills.new;
  const steps = [
    { key: 'drills', count: drills, to: here ? null : '/train', none: plan.drills.total ? t('today.drillsDone') : t('today.drillsNone') },
    { key: 'reviews', count: plan.reviews.due, to: puzzlePath(PUZZLE_MISSED), none: t('today.reviewsDone') },
    { key: 'mine', count: plan.mine.today, to: puzzlePath(MINE_THEME), none: plan.mine.total ? t('today.mineDone') : t('today.mineNone') },
  ] as const;
  return (
    <section className="today-plan" aria-labelledby="today-plan-title">
      <h2 id="today-plan-title"><img className="section-art" src={PROGRESS_ART.calendar} alt="" width="34" height="34" />{plan.todo ? t('today.title', { count: plan.todo }) : t('today.allDone')}</h2>
      <ol>
        {steps.map(step => (
          <li key={step.key} className={step.count ? '' : 'done'}>
            <strong>{t(`today.steps.${step.key}`)}</strong>
            <span>{step.count ? t('today.left', { count: step.count }) : step.none}</span>
            {step.count > 0 && step.to && <Link className="text-button" to={step.to}>{t('today.go')}</Link>}
          </li>
        ))}
      </ol>
    </section>
  );
}
