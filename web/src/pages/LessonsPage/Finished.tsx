import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { Confetti } from '../../components/Confetti';
import { Mascot, Stars } from '../../components/Reward';
import { FlameIcon } from '../../components/story/Streak';
import { useProfile } from '../../hooks/useProfile';
import { useSounds } from '../../hooks/useSounds';
import { api } from '../../lib/api';
import { lessonArt } from '../../lib/art';
import { gamePath, lessonPath, puzzlePath } from '../../lib/routes';
import { storyLessonFocus } from '../../lib/story';
import type { Lesson } from '../../types';
import type { Cinema } from './cinema';
import { useCatalog } from './useCatalog';
import { useToast } from '../../state/AppData';

const SCORED_KINDS = new Set(['play', 'choose', 'guess']);

/** The finish screen: stars, XP, streak, and the next lesson. */
export function Finished({ lesson, cinema, xp }: { lesson: Lesson; cinema: Cinema; xp: number }) {
  const { t } = useTranslation('lessons');
  const { catalog } = useCatalog();
  const profile = useProfile();
  const [result, setResult] = useState<Lesson | null>(null);
  const sounds = useSounds('lesson');
  // Inside Story, "next" stays in the chapter (the lesson's category) and opens through the story entrance.
  const inStory = storyLessonFocus(lesson.slug);
  const pool = catalog?.lessons.filter(l => !inStory || l.category === lesson.category) ?? [];
  const others = pool.filter(l => l.slug !== lesson.slug && !l.completed);
  const position = pool.findIndex(l => l.slug === lesson.slug);
  const next = others.find(l => pool.indexOf(l) > position) ?? others[0];
  const nextPath = (slug: string) => (inStory ? `/story/lesson/${slug}` : lessonPath(slug));

  // The completion fanfare plays once, when the screen arrives.
  useEffect(() => sounds.complete(), [sounds]);

  // Stars and first-try answers are derived from the step ledger; refetch so this run is counted.
  useEffect(() => {
    let live = true;
    api<Lesson>(`api/lessons/${encodeURIComponent(lesson.slug)}`)
      .then(l => { if (live) setResult(l); })
      .catch(() => { /* a backend without stars still gets the celebration */ });
    return () => { live = false; };
  }, [lesson.slug]);

  const stars = typeof result?.stars === 'number' ? result.stars : null;
  const scored = lesson.steps.filter(step => SCORED_KINDS.has(step.kind));
  const firstTry = scored.filter(step => result?.stepResults?.[step.id]?.firstTry).length;
  const streak = profile?.streak;
  const closing = t('finished.closing', { title: lesson.title });
  return (
    <div className="lesson-finished">
      <Confetti />
      <div className="finished-card">
        <div className="finished-hero">
          <span className="finished-glow" aria-hidden="true" />
          <Mascot pose="confetti" size={150} />
        </div>
        <span className="finished-kicker">{t('finished.kicker')}</span>
        <h2>{t('finished.title')}</h2>
        <p className="finished-sub">
          <span><Trans t={t} i18nKey="finished.youFinished" values={{ title: lesson.title }} components={{ strong: <strong /> }} /></span>
          <button type="button" className={`teacher-listen${cinema.speaking ? ' speaking' : ''}`} aria-label={t('teacher.listen')}
            title={t('teacher.listen')} onClick={() => cinema.speak({ narration: closing })}>
            <img src="art/ui3d/sound.webp" alt="" width="16" height="16" />
          </button>
        </p>
        {stars !== null && <Stars count={stars} size={56} animate />}

        <div className="finished-stats">
          {xp > 0 && (
            <span className="finished-stat xp">
              <img src="art/stars/star-gold.png" alt="" width="28" height="28" />
              <b>+{xp}</b>{t('finished.xpEarned')}
            </span>
          )}
          {scored.length > 0 && (
            <span className="finished-stat">
              <img src="art/ui3d/level-complete.webp" alt="" width="28" height="28" />
              <b>{result ? `${firstTry}/${scored.length}` : '–'}</b>{t('finished.firstTry')}
            </span>
          )}
          {streak && (
            <span className={`finished-stat streak${streak.count > 0 ? ' lit' : ''}`}>
              <FlameIcon lit={streak.count > 0} size={28} />
              <b>{streak.count}</b>{t('finished.dayStreak')}
            </span>
          )}
        </div>

        {lesson.coach?.kind === 'placement' ? (
          <PlacementResult lesson={lesson} result={result} titles={Object.fromEntries((catalog?.lessons ?? []).map(l => [l.slug, l.title]))} />
        ) : lesson.coach ? (
          <Link className="button primary squishy finished-go" to="/coach">{t('finished.backToCoach')}</Link>
        ) : next ? (
          <div className="finished-next">
            <span className="finished-next-kicker">{t('finished.upNext')}</span>
            <div className="finished-next-lesson">
              <img src={lessonArt(next.slug, next.unit)} alt="" width="56" height="56" />
              <div>
                <strong>{next.title}</strong>
                <span>{t('meta.stepsAbout', { count: next.steps, minutes: next.minutes })}</span>
              </div>
            </div>
            <Link className="button primary squishy finished-go" to={nextPath(next.slug)}>{t('finished.next', { title: next.title })}</Link>
          </div>
        ) : (
          <Link className="button primary squishy finished-go" to={inStory ? '/story' : lessonPath()}>
            {inStory ? t('finished.backToMap') : t('finished.backToPath')}
          </Link>
        )}

        {!lesson.coach && lesson.steps.some(step => step.kind === 'play') && <p className="finished-review">{t('finished.reviewLater')}</p>}

        <div className="finished-links">
          {inStory && next && !lesson.coach && <Link className="text-button" to="/story">{t('finished.backToMap')}</Link>}
          {lesson.coach?.game && <Link className="text-button" to={gamePath(lesson.coach.game)}>{t('finished.backToGame')}</Link>}
          {lesson.practice && <Link className="text-button" to={puzzlePath(lesson.practice)}>{t('finished.practise')}</Link>}
          <Link className="text-button" to={lessonPath(lesson.slug, 0)}>{t('finished.again')}</Link>
        </div>
      </div>
    </div>
  );
}

/** A placement check's outcome: the lessons whose check you solved cleanly (first try, no hint),
 *  offered to be marked known, and the ones worth taking. */
function PlacementResult({ lesson, result, titles }: { lesson: Lesson; result: Lesson | null; titles: Record<string, string> }) {
  const { t } = useTranslation('lessons');
  const [marked, setMarked] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!result) return null;
  const checks = Object.entries(lesson.coach?.lessons ?? {});
  const clean = (stepId: string) => {
    const run = result.stepResults?.[stepId];
    return !!run?.firstTry && !run.hintsUsed && !run.revealsUsed;
  };
  const known = checks.filter(([stepId]) => clean(stepId)).map(([, slug]) => slug);
  const toTake = checks.filter(([stepId]) => !clean(stepId)).map(([, slug]) => slug);
  return (
    <div className="placement-result">
      <p>{known.length ? t('placement.known', { count: known.length }) : t('placement.noneKnown')}</p>
      {known.length > 0 && <ul>{known.map(slug => <li key={slug}>{titles[slug] ?? slug}</li>)}</ul>}
      {known.length > 0 && (marked
        ? <p className="placement-marked">{t('placement.marked', { count: known.length })}</p>
        : <button type="button" className="button primary squishy finished-go" disabled={busy} onClick={() => {
            setBusy(true);
            api('api/lessons/skip', { slugs: known }).then(() => setMarked(true), e => toast((e as Error).message)).finally(() => setBusy(false));
          }}>{t('placement.mark', { count: known.length })}</button>)}
      {toTake.length > 0 && <>
        <p>{t('placement.toTake')}</p>
        <ul>{toTake.map(slug => <li key={slug}><Link className="text-button" to={lessonPath(slug)}>{titles[slug] ?? slug}</Link></li>)}</ul>
      </>}
      <Link className="text-button" to={lessonPath()}>{t('finished.backToPath')}</Link>
    </div>
  );
}
