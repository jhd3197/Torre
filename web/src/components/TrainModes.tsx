// The other training modes, linked from /train: learning from a game's mistakes and guessing a legend's moves.
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PROGRESS_ART } from '../lib/art';
import { guessPath } from '../lib/routes';

export function TrainModes() {
  const { t } = useTranslation('trainer');
  return (
    <section className="lesson-group" aria-labelledby="train-modes-title">
      <h2 id="train-modes-title">{t('hub.title')}</h2>
      <div className="lesson-cards">
        <Link className="lesson-card" to="/games">
          <img className="card-art" src={PROGRESS_ART.target} alt="" width="72" height="72" loading="lazy" />
          <h3>{t('hub.mistakes')}</h3>
          <p>{t('hub.mistakesBody')}</p>
          <span className="lesson-status">{t('hub.openGames')}</span>
        </Link>
        <Link className="lesson-card" to={guessPath()}>
          <img className="card-art" src={PROGRESS_ART.study} alt="" width="72" height="72" loading="lazy" />
          <h3>{t('hub.guess')}</h3>
          <p>{t('hub.guessBody')}</p>
        </Link>
      </div>
    </section>
  );
}
