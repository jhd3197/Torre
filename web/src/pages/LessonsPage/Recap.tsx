// The recap (Torre Lesson Screens, "Recap"): closes a lesson that lists its rules. Each rule shows
// how its steps went this time; a rule with a slip turns amber and "Practise" replays its steps
// (drills come back with new boards).
import { useTranslation } from 'react-i18next';
import type { Lesson, LessonRule, LessonStep, StepReport } from '../../types';
import { CardIcon } from './CardView';
import { LessonFooter, SectionChip } from './LessonChrome';
import { TeacherRow } from './TeacherRow';
import type { Cinema } from './cinema';

/** Practice replays at most this many steps. */
export const PRACTICE_STEPS = 3;

export interface RuleState { rule: LessonRule; slips: number; steps: LessonStep[] }

const clean = (run: StepReport) => run.firstTry && !run.hintsUsed && !run.revealsUsed;
const slipsOf = (run: StepReport) => Math.max(0, run.attempts - 1) + run.hintsUsed + run.revealsUsed;

/** How each rule went: this visit's runs first, the saved best run for steps not taken now. Steps
 *  never answered do not count against a rule. */
export function ruleStates(lesson: Lesson, runs: Record<string, StepReport>): RuleState[] {
  return (lesson.rules ?? []).map(rule => {
    const steps = lesson.steps.filter(step => step.rule === rule.id && step.scored);
    let slips = 0;
    const weak: LessonStep[] = [];
    for (const step of steps) {
      const run = runs[step.id] ?? lesson.stepResults?.[step.id];
      if (run && !clean(run)) { slips += Math.max(1, slipsOf(run)); weak.push(step); }
    }
    return { rule, slips, steps: weak };
  });
}

export function Recap({ lesson, runs, cinema, onPractise, onFinish }: {
  lesson: Lesson;
  runs: Record<string, StepReport>;
  cinema: Cinema;
  onPractise: (steps: LessonStep[]) => void;
  onFinish: () => void;
}) {
  const { t } = useTranslation('lessons');
  const states = ruleStates(lesson, runs);
  const weak = states.filter(s => s.slips > 0);
  const practice = weak.flatMap(s => s.steps).slice(0, PRACTICE_STEPS);
  const say = weak.length
    ? t('recap.tricky', { rule: weak[0].rule.title.replace(/[.!]$/, ''), count: practice.length })
    : t('recap.clean');
  return (
    <>
      <div className="lesson-stage">
        <div className="lesson-board recap-board">
          <ul className="recap-rules">
            {states.map(({ rule, slips }) => (
              <li key={rule.id} className={slips ? 'weak' : 'good'}>
                <span className="recap-icon"><CardIcon icon={rule.icon} /></span>
                <span className="recap-rule"><strong>{rule.title}</strong>{rule.text}</span>
                <span className="recap-mark" aria-label={slips ? t('recap.weak') : t('recap.good')}>{slips ? '!' : '✓'}</span>
              </li>
            ))}
          </ul>
        </div>
        <aside className="lesson-aside">
          <div className="lesson-step-head">
            <SectionChip section="learn" label={t('recap.chip')} />
            <h3>{t('recap.title')}</h3>
          </div>
          {weak.length > 0 && (
            <div className="recap-second-look">
              <span className="recap-second-kicker">{t('recap.secondLook')}</span>
              {weak.map(({ rule, slips }) => (
                <span key={rule.id} className="recap-second-rule">{t('recap.slips', { count: slips, rule: rule.title.replace(/[.!]$/, '') })}</span>
              ))}
              {practice.length > 0 && (
                <button type="button" className="lesson-soft-button recap-practise" onClick={() => onPractise(practice)}>
                  {t('recap.practise', { count: practice.length })}
                </button>
              )}
            </div>
          )}
          <TeacherRow pose={weak.length ? 'thumbs-up' : 'starry'} speaking={cinema.speaking} onListen={() => cinema.speak({ narration: say })}
            tone={weak.length ? 'neutral' : 'good'}>
            {say}
          </TeacherRow>
        </aside>
      </div>
      <LessonFooter tone={weak.length ? 'neutral' : 'correct'} primary={{ label: t('step.finish'), onClick: onFinish }} />
    </>
  );
}
