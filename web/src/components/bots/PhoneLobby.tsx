// /play/bots on a phone: search, the collections as chips, the event that is on, every bot in a
// two-column grid, and a sheet from the bottom that sets up the game with the one you tap.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { botPicture, coachRating, type Bot } from '../../data/bots';
import { keptCount, lockOf, type BotCollection } from '../../data/collections';
import { loadEvents, isKept } from '../../lib/events';
import { loadStars } from '../../lib/stars';
import { BACK_ICON } from '../workspace/PhoneParts';
import { Mascot } from '../Reward';
import { Segments } from '../Segments';
import { BotPlayPanel, starsKey } from './BotPlayPanel';
import { Flag } from './Flag';

type Sort = 'near' | 'easy';
interface Pick { bot: Bot; collection: BotCollection }

/** How hard a bot is for you, from the gap between its rating and yours. */
function difficulty(elo: number, yours: number | null): 'easy' | 'fair' | 'hard' | 'boss' | null {
  if (!yours || elo <= 0) return null;
  const gap = elo - yours;
  return gap < -250 ? 'easy' : gap < 100 ? 'fair' : gap < 400 ? 'hard' : 'boss';
}

const ORDER: Record<BotCollection['kind'], number> = { season: 0, core: 1, theme: 2, country: 3 };

export function PhoneLobby({ collections, rating, hasSaved }: { collections: BotCollection[]; rating: number | null; hasSaved: boolean }) {
  const { t } = useTranslation('play');
  const navigate = useNavigate();
  const [chip, setChip] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('near');
  const [picked, setPicked] = useState<Pick | null>(null);
  const [level, setLevel] = useState(4);
  const stars = loadStars();
  const progress = loadEvents();
  const target = rating ?? 1180;
  const ratingOf = (bot: Bot) => bot.coach ? coachRating(rating) : bot.elo;

  // Events that are on (or about to be) come first, then the always-on sets, the themes and the countries.
  const chips = useMemo(() => collections
    .filter(c => c.bots.length && (c.kind !== 'season' || c.status === 'live' || c.status === 'soon'))
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind]), [collections]);
  const event = collections.filter(c => c.kind === 'season' && c.status === 'live').sort((a, b) => a.end! - b.end!)[0];
  const collection = chips.find(c => c.id === chip);

  // Everyone, each once, from where they live; or the chosen collection's own.
  const pool: Pick[] = useMemo(() => collection
    ? collection.bots.map(bot => ({ bot, collection }))
    : collections.filter(c => c.kind === 'country' || c.kind === 'theme' || c.kind === 'core')
      .flatMap(c => c.bots.filter(b => !c.abroad?.includes(b.id)).map(bot => ({ bot, collection: c })))
      .filter((p, i, all) => all.findIndex(o => o.bot.id === p.bot.id) === i), [collection, collections]);
  const q = query.trim().toLowerCase();
  const list = pool.filter(({ bot }) => !q || `${bot.name} ${bot.kind} ${bot.tags.join(' ')}`.toLowerCase().includes(q))
    .sort((a, b) => sort === 'near'
      ? Math.abs(ratingOf(a.bot) - target) - Math.abs(ratingOf(b.bot) - target)
      : ratingOf(a.bot) - ratingOf(b.bot));

  const beaten = ({ bot, collection: c }: Pick) => c.kind === 'season' ? isKept(c.id, bot.id, progress) : (stars[starsKey(bot, level, c)] ?? 0) >= 3;

  // The sheet closes with Escape, like a dialog.
  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicked(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [picked]);

  const left = event?.end ? Math.max(0, event.end - Date.now()) : 0;
  const kept = event ? keptCount(event, progress) : 0;

  return (
    <section id="bot-lobby" className="phone-lobby" aria-label={t('lobby.label')}>
      <header className="phone-lobby-head">
        <Link className="phone-icon-button" to="/" aria-label={t('phone.home')}>{BACK_ICON}</Link>
        <h1>{t('phone.pickBot')}</h1>
        {rating && <span className="phone-pill">{t('phone.you', { rating })}</span>}
      </header>
      {hasSaved && <button type="button" id="resume-game" className="phone-resume-bar" onClick={() => navigate('/play')}>{t('lobby.backToGame')}<span aria-hidden="true">›</span></button>}
      <label className="phone-search">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input id="bot-search" type="search" placeholder={t('phone.search')} aria-label={t('phone.search')} value={query} onChange={e => setQuery(e.target.value)} />
      </label>
      <div className="phone-chips" role="group" aria-label={t('phone.collections')}>
        {[{ id: 'all', title: t('phone.all') } as Pick['collection'], ...chips].map(c => (
          <button key={c.id} type="button" aria-pressed={chip === c.id} onClick={() => setChip(c.id)}>
            {c.kind === 'season' && c.status === 'live' && <i className="live-dot" />}
            {c.flag && <Flag code={c.flag} />}
            {c.title}
          </button>
        ))}
      </div>

      {event && !q && (chip === 'all' || chip === event.id) && (
        <button type="button" className="phone-event" data-theme={event.theme} onClick={() => setChip(event.id)}>
          <span className="phone-event-top">
            <span className="phone-event-tag">{t('phone.event')}</span>
            <span className="phone-event-left">{t('phone.left', { days: Math.floor(left / 864e5), hours: Math.floor(left / 36e5) % 24 })}</span>
          </span>
          <strong>{event.title}</strong>
          <small>{t('phone.eventGoal', { count: event.need })}</small>
          <span className="phone-event-progress">
            <span className="meter"><i style={{ width: `${Math.min(100, Math.round(kept / (event.need || 1) * 100))}%` }} /></span>
            <b>{kept}/{event.need}</b>
          </span>
        </button>
      )}

      <div className="phone-lobby-bar">
        <span>{t('phone.count', { count: list.length })}</span>
        <Segments className="bots-segments phone-sort">
          {(['near', 'easy'] as const).map(name => (
            <button key={name} type="button" aria-pressed={sort === name} className={sort === name ? 'selected' : undefined} onClick={() => setSort(name)}>{t(`phone.sort.${name}`)}</button>
          ))}
        </Segments>
      </div>

      {list.length ? (
        <div className="phone-bot-grid">{list.map(pick => {
          const { bot } = pick, diff = difficulty(ratingOf(bot), rating), won = beaten(pick), locked = !!lockOf(pick.collection, bot, progress);
          return (
            <button key={`${pick.collection.id}-${bot.id}`} type="button" className={`phone-bot${locked ? ' locked' : ''}`} onClick={() => setPicked(pick)}>
              <span className="phone-bot-picture">
                <img src={botPicture(bot)} alt="" loading="lazy" />
                <span className="phone-bot-rating">{bot.id === 'sf18' ? `L${level}` : ratingOf(bot)}</span>
                {won && <span className="phone-bot-won" aria-label={t('phone.beaten')}>★</span>}
              </span>
              <span className="phone-bot-text">
                <strong>{bot.name}</strong>
                <small>{bot.kind.split(' · ')[0]}</small>
                {diff && <span className={`phone-diff ${diff}`}>{t(`phone.diff.${diff}`)}</span>}
              </span>
            </button>
          );
        })}</div>
      ) : <p className="bots-empty"><Mascot pose="shrug" size={72} />{t('bots.home.noResults')}</p>}

      {picked && (
        <div className="phone-sheet" role="dialog" aria-modal="true" aria-label={picked.bot.name}>
          <button type="button" className="phone-sheet-backdrop" aria-label={t('lobby.close')} onClick={() => setPicked(null)} />
          <div className="phone-sheet-body">
            <span className="phone-sheet-grip" aria-hidden="true" />
            <BotPlayPanel bot={picked.bot} collection={picked.collection} lock={lockOf(picked.collection, picked.bot, progress)} level={level} onLevel={setLevel} />
          </div>
        </div>
      )}
    </section>
  );
}
