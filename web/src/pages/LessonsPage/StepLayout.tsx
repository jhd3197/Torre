import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MascotPose } from '../../components/Reward';
import type { LessonStep, StepReport } from '../../types';
import type { Cinema } from './cinema';
import { LessonFooter, SectionChip, StepOutline, sectionOf, useLessonPlace, type FooterAction, type FooterHint, type Tone } from './LessonChrome';
import { TeacherRow, type BubbleTone } from './TeacherRow';

export interface StepProps<T> { step: T; onContinue: () => void; last: boolean; cinema: Cinema }
/** Interactive steps (play / choose / guess) also report their result for XP and stars. */
export interface ScoredProps<T> extends StepProps<T> { report: (result: StepReport) => void }

/** Where the step stands: a verdict heads the coach's bubble; the actions go in the footer. */
export interface StepBar {
  verdict?: Tone;
  /** The bubble's tag once committed ("Nicely done!" / "Try again."), or a note on a neutral step. */
  title?: ReactNode;
  /** Replaces the coach's line while a verdict shows. */
  explanation?: ReactNode;
  primary?: FooterAction;
  secondary?: FooterAction[];
  /** The bubble's colour when it is not the verdict's (a hint is amber). */
  tone?: BubbleTone;
}

/** What the coach says on this step, and what the speaker button reads aloud. */
export interface Teacher { pose: MascotPose; line: ReactNode; listen: () => void }

/**
 * A step's frame: the board on the left; beside it the section and title, the coach's bubble,
 * the step's own parts and the lesson outline; the footer under both.
 */
export function StepLayout({ step, cinema, teacher, board, bar, hint, children }: {
  step: LessonStep;
  cinema: Cinema;
  teacher: Teacher;
  board: ReactNode;
  bar: StepBar;
  hint?: FooterHint;
  children?: ReactNode;
}) {
  const { t } = useTranslation('lessons');
  const place = useLessonPlace();
  const verdict = bar.verdict ?? 'neutral';
  const tone = bar.tone ?? (verdict === 'correct' ? 'good' : verdict === 'wrong' ? 'bad' : 'neutral');
  const committed = verdict !== 'neutral' || !!bar.title;
  return (
    <>
      <div className={`lesson-stage${board ? '' : ' no-board'}`}>
        {board && <div className="lesson-board">{board}</div>}
        <aside className="lesson-aside" aria-live="polite">
          <div className="lesson-step-head">
            <SectionChip section={sectionOf(step)} />
            {step.title && <h3>{step.title}</h3>}
          </div>
          <TeacherRow pose={teacher.pose} speaking={cinema.speaking} onListen={teacher.listen} tone={tone} tag={bar.title}>
            {committed && bar.explanation ? bar.explanation : teacher.line}
          </TeacherRow>
          {children}
          {place && (
            <section className="lesson-in-this">
              <h4>{t('view.inThisLesson')}</h4>
              <StepOutline variant="aside" steps={place.lesson.steps} current={place.index}
                done={i => i < place.index || (i === place.index && verdict === 'correct') || (i !== place.index && !!place.lesson.completed)} />
            </section>
          )}
        </aside>
      </div>
      <LessonFooter tone={verdict} primary={bar.primary} secondary={bar.secondary} hint={hint} />
    </>
  );
}
