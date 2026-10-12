// The lesson screen's frame (Torre Lesson design): a header with the exit and one bar per step,
// the section chip over each step, the step outline, and the sticky footer that holds the hint
// and the one primary action. Intro, steps and the finish screen all sit in it.
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFocusExit } from '../../components/story/FocusMode';
import { lessonPath } from '../../lib/routes';
import type { Lesson, LessonStep } from '../../types';
import { sectionOf, type Section } from './kinds';

const SECTION_ICONS: Record<Section, string> = {
  learn: 'M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z',
  watch: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  try: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  quiz: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
};

/** The lesson the screen shows and where the reader is in it, for the parts that list its steps. */
export interface LessonPlace { lesson: Lesson; index: number; reached: number }
export const LessonPlaceContext = createContext<LessonPlace | null>(null);
export const useLessonPlace = () => useContext(LessonPlaceContext);

export function SectionChip({ section, icon = true }: { section: Section; icon?: boolean }) {
  const { t } = useTranslation('lessons');
  return (
    <span className={`lesson-chip section-${section}`}>
      {icon && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={SECTION_ICONS[section]} /></svg>}
      {t(`section.${section}`)}
    </span>
  );
}

/** The lesson's steps as a list: on the intro with their section chips first, beside a step with
 *  a check per finished one. `done(i)` says which are finished; `current` marks the open one. */
export function StepOutline({ steps, done, current, variant }: {
  steps: LessonStep[];
  done: (i: number) => boolean;
  current?: number;
  variant: 'intro' | 'aside';
}) {
  const { t } = useTranslation('lessons');
  return (
    <ol className={`lesson-outline outline-${variant}`}>
      {steps.map((step, i) => {
        const title = step.title || t(`intro.kinds.${step.kind}`);
        const state = done(i) ? 'done' : i === current ? 'current' : current !== undefined && i > current ? 'ahead' : '';
        return (
          <li key={step.id} className={state} aria-current={i === current ? 'step' : undefined}>
            {variant === 'intro'
              ? <SectionChip section={sectionOf(step)} icon={false} />
              : <span className="outline-dot" aria-hidden="true">{done(i) ? '✓' : ''}</span>}
            <span className="outline-title">{title}</span>
            {variant === 'aside' && <span className={`outline-section section-${sectionOf(step)}`}>{t(`section.${sectionOf(step)}`)}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** The top of the lesson: exit, unit and title, one bar per step (the reached ones link back),
 *  and where you are. `index` is null on the intro and the step count on the finish screen. */
export function LessonHeader({ lesson, index, reached, onNavigate, tools }: {
  lesson: Lesson;
  index: number | null;
  reached: number;
  /** A step bar was followed (narration stops). */
  onNavigate?: () => void;
  /** Playback buttons (autoplay, sound) at the end of the bar. */
  tools?: ReactNode;
}) {
  const { t } = useTranslation('lessons');
  const exit = useFocusExit();
  const count = lesson.steps.length;
  const cross = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
  const label = index === null ? t('view.intro') : index >= count ? t('view.complete') : `${index + 1} / ${count}`;
  return (
    <header className="lesson-top">
      {exit
        ? <button type="button" className="lesson-exit" aria-label={t('view.leave')} title={t('view.leave')} onClick={exit}>{cross}</button>
        : <Link className="lesson-exit" to={lessonPath()} aria-label={t('view.leave')} title={t('view.leave')}>{cross}</Link>}
      <div className="lesson-top-name">
        <span>{lesson.unitTitle ?? lesson.unit ?? t('intro.kicker')}</span>
        <strong>{lesson.title}</strong>
      </div>
      <nav className="lesson-bars" aria-label={t('view.steps')}>
        {lesson.steps.map((s, i) => {
          const inStep = index !== null && index < count;
          const state = i === index ? 'current'
            : (index !== null && index >= count) || i < reached || (inStep && lesson.completed) ? 'done' : '';
          const name = s.title ? t('view.stepTitled', { number: i + 1, title: s.title }) : t('view.step', { number: i + 1 });
          return inStep && i <= reached
            ? <Link key={s.id} to={lessonPath(lesson.slug, i)} className={state} onClick={onNavigate}
                aria-current={i === index ? 'step' : undefined} aria-label={name} />
            : <span key={s.id} className={state} aria-label={i <= reached ? name : t('view.stepNotReached', { number: i + 1 })} />;
        })}
      </nav>
      {tools}
      <span className="lesson-top-count">{label}</span>
    </header>
  );
}

export interface FooterAction { label: string; onClick?: () => void; disabled?: boolean; to?: string }
export interface FooterHint { label: string; used: number; total: number; onClick: () => void; disabled?: boolean }
export type Tone = 'neutral' | 'correct' | 'wrong';

/** Enter runs the primary action and H asks for a hint, unless focus is on another control. */
function useFooterKeys(primary?: FooterAction, hint?: FooterHint) {
  const ref = useRef({ primary, hint });
  ref.current = { primary, hint };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.closest('button, a, input, select, textarea, [contenteditable="true"]')) return;
      const { primary: action, hint: help } = ref.current;
      if (e.key === 'Enter' && action && !action.disabled && action.onClick) {
        e.preventDefault();
        action.onClick();
      } else if ((e.key === 'h' || e.key === 'H') && help && !help.disabled) {
        e.preventDefault();
        help.onClick();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

/** The sticky bottom bar: the hint button with one pip per rung, helper buttons, and the primary
 *  action on the right. It turns green once a step is solved. */
export function LessonFooter({ tone = 'neutral', primary, secondary = [], hint }: {
  tone?: Tone;
  primary?: FooterAction;
  secondary?: FooterAction[];
  hint?: FooterHint;
}) {
  const { t } = useTranslation('lessons');
  useFooterKeys(primary, hint);
  const ready = primary && !primary.disabled;
  const primaryBody = <>
    {primary?.label}
    {ready && primary.onClick && <kbd className="lesson-key" aria-hidden="true">{t('footer.enter')}</kbd>}
  </>;
  return (
    <footer className={`lesson-footer tone-${tone}`}>
      <div className="lesson-footer-inner">
        {hint && (
          <button type="button" className={`lesson-hint-button${hint.used ? ' used' : ''}`} aria-label={hint.label} title={hint.label}
            disabled={hint.disabled} onClick={hint.onClick}>
            <span className="hint-word">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
                strokeLinejoin="round" aria-hidden="true"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2z" /></svg>
              {t('footer.hint')}
            </span>
            <span className="hint-pips" aria-hidden="true">
              {Array.from({ length: hint.total }, (_, i) => <i key={i} className={i < hint.used ? 'on' : ''} />)}
            </span>
            <kbd className="lesson-key" aria-hidden="true">H</kbd>
          </button>
        )}
        {secondary.map(action => action.to
          ? <Link key={action.label} className="lesson-soft-button" to={action.to}>{action.label}</Link>
          : <button key={action.label} type="button" className="lesson-soft-button" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>)}
        <span className="lesson-footer-gap" />
        {primary && (primary.to
          ? <Link className="lesson-go verdict-primary" to={primary.to}>{primaryBody}</Link>
          : <button type="button" className="lesson-go verdict-primary" disabled={primary.disabled} onClick={primary.onClick}>{primaryBody}</button>)}
      </div>
    </footer>
  );
}
