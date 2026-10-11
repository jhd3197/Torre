import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { lessonArt } from '../../lib/art';
import { lessonPath } from '../../lib/routes';
import type { LessonCard } from '../../types';

/** One lesson in the library: art, length, progress, and what to take first. */
export function LessonTile({ lesson, first }: { lesson: LessonCard; first: string[] }) {
  const { t } = useTranslation('lessons');
  const started = lesson.step > 0 && lesson.step < lesson.steps && !lesson.completed;
  const status = lesson.skipped ? t('tile.known') : lesson.completed ? t('tile.completed') : started ? t('tile.continue', { step: lesson.step + 1, total: lesson.steps }) : t('tile.start');
  const progress = lesson.completed ? 1 : lesson.steps ? lesson.step / lesson.steps : 0;
  return (
    <Link className={`lesson-card lesson-tile${lesson.completed ? ' completed' : ''}`} to={lessonPath(lesson.slug)}>
      <img className="card-art" src={lessonArt(lesson.slug, lesson.unit)} alt="" width="72" height="72" loading="lazy" />
      <span className="lesson-meta">{lesson.unit ? `${lesson.unitTitle ?? lesson.unit} · ` : ''}{t('meta.minutes', { count: lesson.minutes })} · {t('meta.steps', { count: lesson.steps })}{lesson.video ? ` · ${t('tile.video')}` : ''}</span>
      <h3>{lesson.title}</h3>
      <p>{lesson.summary}</p>
      {first.length > 0 && !lesson.completed && <span className="lesson-first">{t('tile.bestAfter', { lessons: first.join(', ') })}</span>}
      <span className="lesson-progress" aria-hidden="true"><i style={{ width: `${Math.round(progress * 100)}%` }} /></span>
      <span className="lesson-status">{status}</span>
    </Link>
  );
}
