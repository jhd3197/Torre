// The lesson's landing screen: what it covers, a sound check, and one Start
// button that turns the coach on. Starting from a click also lets the browser
// play audio straight away, so narration begins with the first step.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mascot } from './Reward';
import { VideoDialog } from './VideoDialog';
import { lessonArt } from '../lib/art';
import type { Narration } from '../hooks/useNarration';
import type { Lesson } from '../types';

export function LessonIntro({ lesson, resumeAt, speaking, speak, soundOn, onStart, onSkip }: {
  lesson: Lesson;
  /** The step the Start button opens (0 for a fresh start). */
  resumeAt: number;
  speaking: boolean;
  speak: (request: Narration | null) => void;
  soundOn: boolean;
  onStart: (withSound: boolean) => void;
  /** "I already know this": mark the lesson known without taking it. */
  onSkip?: () => void;
}) {
  const { t } = useTranslation('lessons');
  const count = lesson.steps.length;
  const resuming = resumeAt > 0;
  const [watching, setWatching] = useState(false);
  return (
    <div className="lesson-intro">
      <div className="lesson-intro-card">
        <img className="lesson-intro-art" src={lessonArt(lesson.slug, lesson.unit)} alt="" width="120" height="120" />
        <span className="lesson-intro-kicker">{lesson.unitTitle ?? lesson.unit ?? t('intro.kicker')}</span>
        <h2>{lesson.title}</h2>
        {lesson.summary && <p className="lesson-intro-summary">{lesson.summary}</p>}
        <p className="lesson-intro-meta">{t('meta.stepsAbout', { count, minutes: lesson.minutes })}</p>

        <ol className="lesson-intro-steps">
          {lesson.steps.map((step, i) => (
            <li key={step.id} className={i < resumeAt ? 'done' : i === resumeAt ? 'next' : ''}>
              <span className="lesson-intro-dot" aria-hidden="true">{i < resumeAt ? '✓' : i + 1}</span>
              <span>{step.title || t(`intro.kinds.${step.kind}`)}</span>
            </li>
          ))}
        </ol>

        <div className="lesson-intro-sound">
          <Mascot pose={speaking ? 'excited' : 'wave'} size={72} />
          <div>
            <strong>{t('intro.coachTitle')}</strong>
            <p>{t('intro.coachBody')}</p>
          </div>
          <button type="button" className={`button lesson-intro-check${speaking ? ' speaking' : ''}`}
            onClick={() => speak({ narration: t('intro.soundCheck') })}>
            <img src="art/ui3d/sound.webp" alt="" width="18" height="18" />{speaking ? t('intro.playing') : t('intro.testSound')}
          </button>
        </div>

        <div className="lesson-intro-actions">
          <button type="button" className="button primary squishy lesson-intro-start" onClick={() => onStart(true)}>
            {resuming ? t('intro.continueFrom', { step: resumeAt + 1 }) : t('intro.start')}
          </button>
          <button type="button" className="text-button" onClick={() => onStart(false)}>
            {soundOn ? t('intro.startWithoutSound') : t('intro.startSilently')}
          </button>
          {lesson.video && <button type="button" className="button lesson-intro-watch" onClick={() => setWatching(true)}>{t('intro.watch')}</button>}
          {onSkip && !lesson.completed && <button type="button" className="text-button" onClick={onSkip}>{t('intro.alreadyKnow')}</button>}
        </div>
        {lesson.skipped && <p className="lesson-intro-meta">{t('intro.markedKnown')}</p>}
      </div>
      {lesson.video && <VideoDialog video={lesson.video} title={lesson.title} open={watching} onClose={() => setWatching(false)} />}
    </div>
  );
}
