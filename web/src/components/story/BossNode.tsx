// The boss node: the chapter finale. V1 is an intro card that starts a game
// against the boss using the existing PlayPage machinery (the bot-stars record
// in localStorage is what StoryPage reads to open the next chapter).
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mascot, Stars } from '../Reward';
import { chapterBoss, type StoryChapter } from '../../data/story';
import { START_FEN } from '../../lib/format';
import { bossStars } from '../../lib/story';
import { loadStars } from '../../lib/stars';
import { savePlay } from '../../lib/storage';

export function BossNode({ chapter }: { chapter: StoryChapter }) {
  const navigate = useNavigate();
  const { t } = useTranslation('story');
  const boss = chapterBoss(chapter);
  if (!boss) {
    return <p className="lessons-empty" role="alert">{t('boss.unavailable')}</p>;
  }
  const stars = bossStars(chapter, loadStars());
  const beaten = stars > 0;

  function fight() {
    savePlay({ initialFen: START_FEN, moves: [], playerColor: 'white', level: 4, result: null, botId: boss!.id, elo: boss!.elo });
    navigate('/play', { state: { started: Date.now() } });
  }

  return (
    <div className="boss-intro">
      <span className="boss-kicker">{t('boss.kicker', { chapter: chapter.title })}</span>
      <img className="boss-portrait" src={boss.avatar} alt={boss.name} width="148" height="148" />
      <h2>{boss.name}</h2>
      <span className="lesson-meta">{t('boss.meta', { elo: boss.elo, kind: boss.kind })}</span>
      {boss.hello && <p className="boss-quote">{t('boss.quote', { hello: boss.hello })}</p>}
      <p className="boss-desc">{boss.desc}</p>
      <Stars count={stars} size={30} label={t('boss.stars', { name: boss.name, stars })} />
      <p className="boss-stakes">{beaten
        ? t('boss.beaten', { name: boss.name })
        : t('boss.stakes')}</p>
      <button type="button" className="button primary squishy boss-start" onClick={fight}>
        {beaten ? t('boss.fightAgain') : t('boss.start')}
      </button>
      <p className="boss-note"><Mascot pose="determined" size={40} /><span>{t('boss.note')}</span></p>
    </div>
  );
}
