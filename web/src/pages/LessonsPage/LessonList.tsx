import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { lessonPath } from '../../lib/routes';
import { useToast } from '../../state/AppData';
import type { DrillDeck, LessonCard, LessonCategory } from '../../types';
import { OpeningLibrary } from '../../components/OpeningStory';
import { LessonTile } from './LessonTile';
import { useCatalog } from './useCatalog';

/** The lesson library: every lesson as a card, grouped by category. Story is the guided route
 *  through them; this is the catalog for picking any lesson directly. */
export function LessonList() {
  const { t } = useTranslation('lessons');
  const { catalog, error, load } = useCatalog();
  const navigate = useNavigate();
  const toast = useToast();
  const [checking, setChecking] = useState<LessonCategory | null>(null);
  // Exercises from finished lessons that are due again (spaced review in Train).
  const [due, setDue] = useState(0);
  useEffect(() => {
    let live = true;
    api<DrillDeck>('api/drills?only=lessons').then(deck => { if (live) setDue(deck.lesson_due ?? 0); }, () => { /* the review is a bonus */ });
    return () => { live = false; };
  }, []);
  // A placement check over the category's lessons not taken yet: pass one and skip that lesson.
  function placement(category: LessonCategory) {
    setChecking(category);
    api<{ slug: string }>('api/lessons/placement', { category })
      .then(({ slug }) => navigate(lessonPath(slug)))
      .catch(e => toast((e as Error).message))
      .finally(() => setChecking(null));
  }
  if (error) return <p className="lessons-empty" role="alert">{error} <button type="button" className="text-button" onClick={load}>{t('list.tryAgain')}</button></p>;
  if (!catalog) return <p className="lessons-empty" role="status">{t('list.loading')}</p>;
  const titles = Object.fromEntries(catalog.lessons.map(l => [l.slug, l.title]));
  const done = new Set(catalog.lessons.filter(l => l.completed).map(l => l.slug));
  const categories = [...new Set(catalog.lessons.map(l => l.category))];
  const firstOf = (lesson: LessonCard) => lesson.requires.filter(r => !done.has(r)).map(r => titles[r]);
  const videos = catalog.lessons.filter(l => l.video);
  return (
    <>
      <div className="lessons-lead">
        <p className="lessons-intro">
          {catalog.lessons.length > 0 && t('list.completed', { done: done.size, total: catalog.lessons.length })}
        </p>
        <Link className="button" to="/story">{t('list.followStory')}</Link>
      </div>
      {due > 0 && (
        <p className="lessons-review" role="status">{t('list.reviewDue', { count: due })}{' '}
          <Link className="text-button" to="/train?only=lessons">{t('list.reviewNow')}</Link></p>
      )}
      {!catalog.lessons.length && <p className="lessons-empty">{t('list.empty')}</p>}
      {videos.length > 0 && (
        <section className="lesson-group" aria-labelledby="lessons-videos">
          <div className="lesson-group-head">
            <h2 id="lessons-videos">{t('list.videos')}</h2>
            <span>{t('list.videosNote')}</span>
          </div>
          <div className="lesson-cards">
            {videos.map(lesson => <LessonTile key={lesson.slug} lesson={lesson} first={firstOf(lesson)} />)}
          </div>
        </section>
      )}
      {categories.map(category => {
        const lessons = catalog.lessons.filter(l => l.category === category);
        const finished = lessons.filter(l => l.completed).length;
        return (
          <section key={category} className="lesson-group" aria-labelledby={`lessons-${category}`}>
            <div className="lesson-group-head">
              <h2 id={`lessons-${category}`}>{t(`categories.${category}`)}</h2>
              <span>{t('list.groupDone', { done: finished, total: lessons.length })}</span>
              {lessons.length - finished >= 2 && (
                <button type="button" className="text-button" disabled={checking !== null} onClick={() => placement(category)}>
                  {t('list.placement')}
                </button>
              )}
            </div>
            <div className="lesson-cards">
              {lessons.map(lesson => (
                <LessonTile key={lesson.slug} lesson={lesson} first={firstOf(lesson)} />
              ))}
            </div>
          </section>
        );
      })}
      <OpeningLibrary />
      {catalog.problems.length > 0 && (
        <details className="lesson-problems">
          <summary>{t('list.problems', { count: catalog.problems.length })}</summary>
          <ul>{catalog.problems.map(p => <li key={p}>{p}</li>)}</ul>
        </details>
      )}
    </>
  );
}
