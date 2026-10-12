import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useNarration, setLessonSoundOn, useLessonSoundOn } from '../../hooks/useNarration';
import { refreshProfile } from '../../hooks/useProfile';
import { api } from '../../lib/api';
import { lessonPath } from '../../lib/routes';
import { useToast } from '../../state/AppData';
import { LessonIntro } from '../../components/LessonIntro';
import type { Lesson, LessonStep, StepReport, StepScore } from '../../types';
import type { Cinema } from './cinema';
import { Finished } from './Finished';
import { StepView } from './kinds';
import { Recap } from './Recap';
import { LessonHeader, LessonPlaceContext } from './LessonChrome';

const DONE = 'done';

/** The lesson's own full-window screen: the app's rail and top bar step aside while it is open. */
function LessonScreen({ children }: { children: ReactNode }) {
  useEffect(() => {
    const body = document.body;
    if (!body.dataset.focus) body.dataset.focus = 'lesson';
    return () => { if (body.dataset.focus === 'lesson') delete body.dataset.focus; };
  }, []);
  return <div className="lesson-screen">{children}</div>;
}

/** One lesson: the get-ready screen, a step, or the finish screen, by the URL's step. */
export function LessonView({ slug, stepParam }: { slug: string; stepParam?: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation('lessons');
  const toast = useToast();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  const [sessionXp, setSessionXp] = useState(0);
  // When this visit opened its first step: the finish screen shows how long the lesson took.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // This visit's answers, by step: the recap judges each rule on them.
  const [runs, setRuns] = useState<Record<string, StepReport>>({});
  // On the done screen: the recap first (when the lesson lists rules), any practice it starts, then the finish.
  const [recapDone, setRecapDone] = useState(false);
  const [practice, setPractice] = useState<{ steps: LessonStep[]; at: number } | null>(null);
  const soundOn = useLessonSoundOn();
  const narration = useNarration();
  const { speaking, speak, stop } = narration;
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

  const onStep = stepParam !== undefined && !finished;
  useEffect(() => { if (onStep) setStartedAt(at => at ?? Date.now()); }, [onStep]);
  // Leaving the done screen (taking the lesson again) brings the recap back next time.
  useEffect(() => { if (!finished) { setRecapDone(false); setPractice(null); } }, [finished]);

  // A scored step was completed: post its result, bank the XP, refresh the header chip.
  const reportScore = useCallback((stepId: string, result: StepReport) => {
    setRuns(r => ({ ...r, [stepId]: result }));
    api<StepScore>(`api/lessons/${encodeURIComponent(slug)}/steps/${encodeURIComponent(stepId)}`, result)
      .then(score => {
        if (score.xpGained > 0) setSessionXp(xp => xp + score.xpGained);
        refreshProfile();
      })
      .catch(e => toast((e as Error).message));
  }, [slug, toast]);

  if (error) return <LessonScreen><p className="lessons-empty" role="alert">{error} <Link className="text-button" to={lessonPath()}>{t('view.allLessons')}</Link></p></LessonScreen>;
  if (!lesson) return <LessonScreen><p className="lessons-empty" role="status">{t('view.loading')}</p></LessonScreen>;

  const count = lesson.steps.length;
  // No step in the URL: the get-ready screen, whose Start resumes where the reader left off
  // (or starts over once finished) with the coach switched on.
  if (stepParam === undefined) {
    const resumeAt = lesson.step >= count ? 0 : lesson.step;
    return (
      <LessonScreen>
        <LessonHeader lesson={lesson} index={null} reached={resumeAt} />
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
      </LessonScreen>
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

  const drilling = finished && practice ? practice.steps[practice.at] : null;
  const step = drilling ?? lesson.steps[index];
  const report = (result: StepReport) => reportScore(step.id, result);
  const last = index === count - 1;
  const tools = !finished && (
    <div className="lesson-transport" role="group" aria-label={t('view.playback')}>
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
    </div>
  );
  return (
    <LessonScreen>
      <LessonHeader lesson={lesson} index={index} reached={reached} onNavigate={stop} tools={tools} />
      <LessonPlaceContext.Provider value={{ lesson, index: drilling ? lesson.steps.indexOf(drilling) : index, reached,
        back: index > 0 && !finished ? () => { stop(); navigate(lessonPath(slug, index - 1)); } : undefined }}>
        {drilling && practice
          ? <StepView key={`practice-${practice.at}`} step={drilling} last={false} cinema={cinema} report={report}
              onContinue={() => { stop(); setPractice(p => p && p.at + 1 < p.steps.length ? { ...p, at: p.at + 1 } : null); }} />
          : finished && lesson.rules?.length && !recapDone
            ? <Recap lesson={lesson} runs={runs} cinema={cinema} onPractise={steps => setPractice({ steps, at: 0 })} onFinish={() => setRecapDone(true)} />
          : finished ? <Finished lesson={lesson} cinema={cinema} xp={sessionXp} startedAt={startedAt} />
          : <StepView key={step.id} step={step} onContinue={advance} last={last} cinema={cinema} report={report} />}
      </LessonPlaceContext.Provider>
    </LessonScreen>
  );
}
