import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useNarration, setLessonSoundOn, useLessonSoundOn } from '../../hooks/useNarration';
import { refreshProfile } from '../../hooks/useProfile';
import { usePageTitle } from '../../hooks/usePageTitle';
import { api } from '../../lib/api';
import { lessonArt } from '../../lib/art';
import { lessonPath } from '../../lib/routes';
import { storyLessonFocus } from '../../lib/story';
import { useToast } from '../../state/AppData';
import { LessonIntro } from '../../components/LessonIntro';
import type { Lesson, StepReport, StepScore } from '../../types';
import type { Cinema } from './cinema';
import { ChooseView } from './ChooseView';
import { ExplainView } from './ExplainView';
import { Finished } from './Finished';
import { GuessView } from './GuessView';
import { PlayView } from './PlayView';
import { ReelView } from './ReelView';

const DONE = 'done';

/** One lesson: the get-ready screen, a step, or the finish screen, by the URL's step. */
export function LessonView({ slug, stepParam }: { slug: string; stepParam?: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation('lessons');
  const toast = useToast();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  const [sessionXp, setSessionXp] = useState(0);
  const soundOn = useLessonSoundOn();
  const narration = useNarration();
  const { speaking, speak, stop } = narration;
  // The top bar names the lesson; inside Story's focus mode there is no top bar, so the step header does.
  const focused = storyLessonFocus(slug);
  usePageTitle(lesson && !focused ? { title: lesson.title, art: lessonArt(lesson.slug, lesson.unit) } : null);
  const finished = stepParam === DONE;
  const cinema = useMemo<Cinema>(() => ({ slug, autoplay: autoplay && !finished, speaking, speak, stop }),
    [slug, autoplay, finished, speaking, speak, stop]);

  useEffect(() => {
    let live = true;
    api<Lesson>(`api/lessons/${encodeURIComponent(slug)}`)
      .then(l => { if (live) setLesson(l); })
      .catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [slug]);

  // A scored step was completed: post its result, bank the XP, refresh the header chip.
  const reportScore = useCallback((stepId: string, result: StepReport) => {
    api<StepScore>(`api/lessons/${encodeURIComponent(slug)}/steps/${encodeURIComponent(stepId)}`, result)
      .then(score => {
        if (score.xpGained > 0) setSessionXp(xp => xp + score.xpGained);
        refreshProfile();
      })
      .catch(e => toast((e as Error).message));
  }, [slug, toast]);

  if (error) return <p className="lessons-empty" role="alert">{error} <Link className="text-button" to={lessonPath()}>{t('view.allLessons')}</Link></p>;
  if (!lesson) return <p className="lessons-empty" role="status">{t('view.loading')}</p>;

  const count = lesson.steps.length;
  // No step in the URL: the get-ready screen, whose Start resumes where the reader left off
  // (or starts over once finished) with the coach switched on.
  if (stepParam === undefined) {
    const resumeAt = lesson.step >= count ? 0 : lesson.step;
    return (
      <LessonIntro lesson={lesson} resumeAt={resumeAt} speaking={speaking} speak={speak} soundOn={soundOn}
        onStart={withSound => {
          stop();
          setLessonSoundOn(withSound);
          setAutoplay(withSound);
          navigate(lessonPath(slug, resumeAt));
        }}
        onSkip={lesson.coach ? undefined : () => {
          api('api/lessons/skip', { slugs: [slug] })
            .then(() => navigate(lessonPath()))
            .catch(e => toast((e as Error).message));
        }} />
    );
  }
  if (finished && lesson.step < count) return <Navigate to={lessonPath(slug, lesson.step)} replace />;
  const index = finished ? count : Number(stepParam) - 1;
  if (!finished && !(Number.isInteger(index) && index >= 0 && index < count)) return <Navigate to={lessonPath(slug, 0)} replace />;
  const reached = Math.max(lesson.step, index);

  const advance = () => {
    stop();
    const next = index + 1;
    if (next === count) setAutoplay(false);
    if (next > lesson.step) {
      setLesson({ ...lesson, step: next, completed: next === count ? new Date().toISOString() : lesson.completed });
      api('api/lessons/progress', { slug, step: next }).catch(e => toast((e as Error).message));
    }
    navigate(next === count ? `${lessonPath(slug)}/${DONE}` : lessonPath(slug, next));
  };

  const step = lesson.steps[index];
  const report = (result: StepReport) => reportScore(step.id, result);
  const last = index === count - 1;
  return (
    <>
      {/* The finish screen is its own summary: no step strip above it outside Story's focus mode. */}
      {(!finished || focused) && <header className="lesson-header">
        {focused && <h2 className="icon-text"><img src={lessonArt(lesson.slug, lesson.unit)} alt="" width="36" height="36" />{lesson.title}</h2>}
        {!finished && <div className="lesson-transport" role="group" aria-label={t('view.playback')}>
          <button type="button" className="transport-button" aria-label={autoplay ? t('view.pauseLesson') : t('view.playLesson')} aria-pressed={autoplay}
            title={autoplay ? t('view.pauseAutoplay') : t('view.autoplay')}
            onClick={() => { if (autoplay) stop(); setAutoplay(on => !on); }}>
            <img src={`art/ui3d/${autoplay ? 'pause' : 'play'}.webp`} alt="" width="20" height="20" />
          </button>
          <button type="button" className={`transport-button${speaking ? ' speaking' : ''}`} aria-pressed={soundOn}
            aria-label={soundOn ? t('view.mute') : t('view.unmute')} title={soundOn ? t('view.mute') : t('view.unmute')}
            onClick={() => { if (soundOn) stop(); setLessonSoundOn(!soundOn); }}>
            <img src={`art/ui3d/${soundOn ? 'sound' : 'mute'}.webp`} alt="" width="20" height="20" />
          </button>
        </div>}
        <nav className="lesson-steps" aria-label={t('view.steps')}>
          {lesson.steps.map((s, i) => i <= reached
            ? <Link key={s.id} to={lessonPath(slug, i)} className={i === index ? 'current' : i < reached || lesson.completed ? 'done' : ''}
                onClick={() => stop()}
                aria-current={i === index ? 'step' : undefined} aria-label={s.title ? t('view.stepTitled', { number: i + 1, title: s.title }) : t('view.step', { number: i + 1 })} />
            : <span key={s.id} aria-label={t('view.stepNotReached', { number: i + 1 })} />)}
        </nav>
        <span className="lesson-count">{finished ? t('view.complete') : t('view.stepOf', { number: index + 1, count })}</span>
      </header>}
      {finished ? <Finished lesson={lesson} cinema={cinema} xp={sessionXp} />
        : step.kind === 'explain' ? <ExplainView key={step.id} step={step} onContinue={advance} last={last} cinema={cinema} />
        : step.kind === 'play' ? <PlayView key={step.id} step={step} onContinue={advance} last={last} cinema={cinema} report={report} />
        : step.kind === 'reel' ? <ReelView key={step.id} step={step} onContinue={advance} last={last} cinema={cinema} />
        : step.kind === 'guess' ? <GuessView key={step.id} step={step} onContinue={advance} last={last} cinema={cinema} report={report} />
        : <ChooseView key={step.id} step={step} onContinue={advance} last={last} cinema={cinema} report={report} />}
    </>
  );
}
