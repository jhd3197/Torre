// An opening's story card: where the name comes from, its idea, and the lessons that teach it.
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { OPENING_STORIES, type OpeningStory as Story } from '../data/openings';
import { lessonPath } from '../lib/routes';

export function OpeningStory({ story, art, titled = true }: { story: Story; art?: string; titled?: boolean }) {
  const { t } = useTranslation('board');
  return (
    <div className="opening-story">
      {art && <img className="opening-story-art" src={art} alt="" width="72" height="72" loading="lazy" />}
      <div>
        {titled && <h3>{story.name} <span className="opening-story-moves">{story.moves}</span></h3>}
        <p><strong>{t('openings.name')}</strong> {story.origin}</p>
        <p><strong>{t('openings.idea')}</strong> {story.idea}</p>
        {(story.course || story.game) && (
          <p className="opening-story-links">
            {story.course && <Link className="text-button" to={lessonPath(story.course)}>{t('openings.lesson')} ↗</Link>}
            {story.game && <Link className="text-button" to={lessonPath(story.game.lesson)}>{t('openings.famousGame', { label: story.game.label })} ↗</Link>}
          </p>
        )}
      </div>
    </div>
  );
}

/** Every opening family with its story, for browsing. */
export function OpeningLibrary() {
  const { t } = useTranslation('board');
  return (
    <section className="opening-library" aria-labelledby="opening-library">
      <h2 id="opening-library">{t('openings.library')}</h2>
      <p className="lessons-intro">{t('openings.libraryIntro')}</p>
      <div className="opening-library-grid">
        {Object.entries(OPENING_STORIES).map(([key, story]) => (
          <details key={key} className="opening-library-item">
            <summary>
              <img src={`art/openings/${key}.webp`} alt="" width="48" height="48" loading="lazy" />
              <span><strong>{story.name}</strong><small>{story.moves}</small></span>
            </summary>
            <OpeningStory story={story} titled={false} />
          </details>
        ))}
      </div>
    </section>
  );
}
