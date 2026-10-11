// /lessons — short step-by-step lessons, written as data (lessons.py, lessons/*.json).
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LessonList } from './LessonList';
import { LessonView } from './LessonView';

export function LessonsPage() {
  const { slug, step } = useParams();
  const { t } = useTranslation('lessons');
  useEffect(() => { document.body.dataset.page = 'lessons'; }, []);
  return (
    <section id="lessons" className="lessons" aria-label={t('page.label')}>
      {slug ? <LessonView key={slug} slug={slug} stepParam={step} /> : <LessonList />}
    </section>
  );
}
