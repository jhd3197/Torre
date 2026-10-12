// The lesson's landing screen: the piece or idea it is about, the coach introducing it, the steps
// ahead, and one Start button that turns the coach on. Starting from a click also lets the browser
// play audio straight away, so narration begins with the first step.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mascot } from './Reward';
import { VideoDialog } from './VideoDialog';
import { lessonArt } from '../lib/art';
import type { Narration } from '../hooks/useNarration';
import type { Lesson } from '../types';
import { LessonFooter, StepOutline } from '../pages/LessonsPage/LessonChrome';

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
    <>
      <div className="lesson-intro">
        <div className="lesson-intro-art">
          <img src={lessonArt(lesson.slug, lesson.unit)} alt="" width="200" height="200" />
        </div>
        <div className="lesson-intro-body">
          <span className="lesson-pill">{t('meta.stepsAbout', { count, minutes: lesson.minutes })}</span>
          <h2>{lesson.title}</h2>
          <div className="coach-row">
            <span className="coach-avatar"><Mascot pose={speaking ? 'excited' : 'wave'} size={72} /></span>
            <div className="coach-bubble">
              <div className="bubble-text">{lesson.summary || t('intro.coachBody')}</div>
              <div className="lesson-intro-sound">
                <button type="button" className={`lesson-intro-check${speaking ? ' speaking' : ''}`}
                  onClick={() => speak({ narration: t('intro.soundCheck') })}>
                  <img src="art/ui3d/sound.webp" alt="" width="16" height="16" />{speaking ? t('intro.playing') : t('intro.testSound')}
                </button>
                <span>{t('intro.coachTitle')}</span>
              </div>
            </div>
          </div>
          <StepOutline variant="intro" steps={lesson.steps} done={i => i < resumeAt} current={resuming ? resumeAt : undefined} />
          {lesson.skipped && <p className="lesson-intro-meta">{t('intro.markedKnown')}</p>}
        </div>
      </div>
      <LessonFooter
        primary={{ label: resuming ? t('intro.continueFrom', { step: resumeAt + 1 }) : t('intro.start'), onClick: () => onStart(true) }}
        secondary={[
          { label: soundOn ? t('intro.startWithoutSound') : t('intro.startSilently'), onClick: () => onStart(false) },
          ...(lesson.video ? [{ label: t('intro.watch'), onClick: () => setWatching(true) }] : []),
          ...(onSkip && !lesson.completed ? [{ label: t('intro.alreadyKnow'), onClick: onSkip }] : []),
        ]} />
      {lesson.video && <VideoDialog video={lesson.video} title={lesson.title} open={watching} onClose={() => setWatching(false)} />}
    </>
  );
}
