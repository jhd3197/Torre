// /play/bots — the bot lobby's home: the event that is on (or coming), good matches for your rating,
// every country, the themed collections, and the always-on sets. Each opens its collection page.
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { botPicture, type Bot } from '../data/bots';
import { collectionOf, keptCount, type BotCollection } from '../data/collections';
import { BotTile, Flag } from '../components/bots/BotTile';
import { EventClock, daysUntil } from '../components/bots/EventClock';
import { Mascot } from '../components/Reward';
import { useBotCollections } from '../hooks/useBotCollections';
import { loadEvents } from '../lib/events';
import { loadStars } from '../lib/stars';
import { loadPlay } from '../lib/storage';
import { usePhone } from '../hooks/usePhone';
import { PhoneLobby } from '../components/bots/PhoneLobby';

export const collectionPath = (id: string, bot?: string) => `/play/bots/${id}${bot ? `?bot=${encodeURIComponent(bot)}` : ''}`;
/** Beaten: won a game against it (three stars). */
export const beaten = (stars: Record<string, number>, bot: Bot) => (stars[bot.id] ?? 0) >= 3;
/** How many countries and collections the home shows before (and per) Show more: two rows of countries, three of collections. */
const COUNTRY_PAGE = 10, THEME_PAGE = 9;
/** The figures a collection shows on its tile: its first few with pictures. */
const faces = (collection: BotCollection, count: number) => collection.bots.filter(b => b.avatar || b.portrait).slice(0, count);

export function BotsHomePage() {
  const { t, i18n } = useTranslation('play');
  const navigate = useNavigate();
  const location = useLocation();
  const { collections, rating } = useBotCollections();
  const [query, setQuery] = useState('');
  // Countries and collections show a couple of rows at first; Show more adds the next ones.
  const [countryCount, setCountryCount] = useState(COUNTRY_PAGE);
  const [themeCount, setThemeCount] = useState(THEME_PAGE);
  const stars = loadStars();
  const progress = loadEvents();
  const hasSaved = !!loadPlay();
  const phone = usePhone();

  useEffect(() => {
    document.body.dataset.page = 'bots';
    return () => { document.body.dataset.page = 'board'; };
  }, []);
  // Other pages open the lobby on a bot (the Engine Lab's Play): open its collection on it.
  const wanted = (location.state as { bot?: string } | null)?.bot;
  useEffect(() => {
    const home = wanted ? collectionOf(collections, wanted) : undefined;
    if (home) navigate(collectionPath(home.id, wanted), { replace: true });
  }, [wanted, collections, navigate]);

  const events = collections.filter(c => c.kind === 'season');
  const live = events.filter(c => c.status === 'live').sort((a, b) => a.end! - b.end!);
  const soon = events.filter(c => c.status === 'soon');
  const hero = live[0] ?? soon[0];
  const strip = [...live.slice(1), ...soon.filter(c => c !== hero).slice(0, 2), ...events.filter(c => c.status === 'ended' && keptCount(c, progress) > 0)].slice(0, 3);
  const countries = collections.filter(c => c.kind === 'country');
  const themes = collections.filter(c => c.kind === 'theme');
  const core = collections.filter(c => c.kind === 'core');
  // Everyone you can play, each once, from the collections they live in.
  const people = useMemo(() => collections.filter(c => c.kind === 'country' || c.kind === 'theme' || c.id === 'always')
    .flatMap(c => c.bots.filter(b => !b.coach && !c.abroad?.includes(b.id)).map(bot => ({ bot, collection: c }))), [collections]);
  const target = rating ?? 1180;
  const matches = people.filter(p => !beaten(stars, p.bot)).sort((a, b) => Math.abs(a.bot.elo - target) - Math.abs(b.bot.elo - target)).slice(0, 6);
  const q = query.trim().toLowerCase();
  const results = q ? collections.flatMap(c => c.kind === 'season' ? [] : c.bots.filter(b => !c.abroad?.includes(b.id)).map(bot => ({ bot, collection: c })))
    .filter(({ bot }) => `${bot.name} ${bot.kind} ${bot.tags.join(' ')}`.toLowerCase().includes(q)).slice(0, 36) : [];
  const date = (time: number) => new Date(time - 1).toLocaleDateString(i18n.language, { month: 'long', day: 'numeric' });

  if (phone) return <PhoneLobby collections={collections} rating={rating} hasSaved={hasSaved} />;

  function surprise() {
    const pool = people.filter(p => Math.abs(p.bot.elo - target) <= 200);
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? people[0];
    if (pick) navigate(collectionPath(pick.collection.id, pick.bot.id));
  }

  return (
    <section id="bot-lobby" className="bots-home" aria-label={t('lobby.label')}>
      <header className="bots-header">
        <h1>{t('lobby.title')}</h1>
        <div className="bots-header-actions">
          <input id="bot-search" type="search" placeholder={t('bots.home.search')} aria-label={t('bots.home.search')} value={query} onChange={e => setQuery(e.target.value)} />
          {hasSaved && <button id="resume-game" type="button" className="bots-button" onClick={() => navigate('/play')}>{t('lobby.backToGame')}</button>}
          <button id="surprise-bot" type="button" className="bots-button" onClick={surprise}>{t('lobby.surprise')}</button>
          <button id="train-bot" type="button" className="bots-button solid" onClick={() => navigate('/play/bots/yours?train=1')}>{t('lobby.trainBot')}</button>
        </div>
      </header>

      {q ? (
        <section className="bots-section" aria-label={t('bots.home.results', { count: results.length, query: query.trim() })}>
          <div className="bots-section-head"><h2>{t('bots.home.results', { count: results.length, query: query.trim() })}</h2>
            <button type="button" className="text-button" onClick={() => setQuery('')}>{t('bots.home.clear')}</button></div>
          {results.length ? <div className="bots-grid">{results.map(({ bot, collection }) => (
            <BotTile key={`${collection.id}-${bot.id}`} bot={bot} rating={bot.id === 'sf18' ? 'L4' : bot.elo} note={collection.title}
              onClick={() => navigate(collectionPath(collection.id, bot.id))} />
          ))}</div> : <p className="bots-empty"><Mascot pose="shrug" size={72} />{t('bots.home.noResults')}</p>}
        </section>
      ) : <>
        {hero && <EventHero event={hero} kept={keptCount(hero, progress)} date={date} onOpen={bot => navigate(collectionPath(hero.id, bot))} />}

        {strip.length > 0 && <div className="event-strip">{strip.map(event => {
          const count = keptCount(event, progress);
          return (
            <Link key={event.id} className="event-chip" data-theme={event.theme} to={collectionPath(event.id)}>
              <span className="face-stack">{faces(event, 3).map(bot => <img key={bot.id} src={botPicture(bot)} alt="" className={event.status === 'soon' ? 'waiting' : ''} />)}</span>
              <span className="event-chip-text"><strong>{event.title}</strong>
                <small>{event.status === 'ended' ? t('bots.events.keptOf', { count, total: event.bots.length }) : t('bots.events.characters', { count: event.bots.length })}</small></span>
              <span className={`event-pill ${event.status}`}>{event.status === 'live' ? t('bots.events.live') : event.status === 'soon' ? t('bots.events.inDays', { count: daysUntil(event.start!) }) : t('bots.events.ended')}</span>
            </Link>
          );
        })}</div>}

        <section className="bots-section" aria-labelledby="matches-title">
          <div className="bots-section-head"><h2 id="matches-title">{t('bots.home.matches')}</h2>
</div>
          <div className="bots-grid">{matches.map(({ bot, collection }) => {
            const diff = bot.elo - target;
            return <BotTile key={bot.id} bot={bot} rating={bot.elo} badge={collection.title}
              note={diff === 0 ? t('bots.home.exact') : t(diff > 0 ? 'bots.home.above' : 'bots.home.below', { count: Math.abs(diff) })}
              onClick={() => navigate(collectionPath(collection.id, bot.id))} />;
          })}</div>
        </section>

        <section className="bots-section" aria-labelledby="world-title">
          <div className="bots-section-head"><h2 id="world-title">{t('bots.home.world')}</h2></div>
          <div className="country-grid">{countries.slice(0, countryCount).map(country => {
            const won = country.bots.filter(b => beaten(stars, b)).length;
            return (
              <Link key={country.id} className="country-card" to={collectionPath(country.id)}>
                <span className="country-faces">{faces(country, 4).map(bot => <img key={bot.id} src={botPicture(bot)} alt="" />)}</span>
                <span className="country-body">
                  <span className="country-title">{country.flag && <Flag code={country.flag} className="flag country-flag" />}<strong>{country.title}</strong><small>{won} / {country.bots.length}</small></span>
                  <span className="meter"><i style={{ width: `${Math.round(won / (country.bots.length || 1) * 100)}%` }} /></span>
                  <small className="country-note">{country.neighbour ? t('bots.home.neighbour', { name: country.neighbour.name })
                    : country.abroad ? t('bots.home.abroad', { count: country.abroad.length }) : t('bots.events.characters', { count: country.bots.length })}</small>
                </span>
              </Link>
            );
          })}</div>
          <ShowMore shown={countryCount} total={countries.length} onMore={() => setCountryCount(countryCount + COUNTRY_PAGE)} />
        </section>

        <section className="bots-section" aria-labelledby="themes-title">
          <div className="bots-section-head"><h2 id="themes-title">{t('bots.home.themes')}</h2></div>
          <div className="collection-tiles">{themes.slice(0, themeCount).map(theme => <CollectionTile key={theme.id} collection={theme} stars={stars} />)}</div>
          <ShowMore shown={themeCount} total={themes.length} onMore={() => setThemeCount(themeCount + THEME_PAGE)} />
        </section>

        <section className="bots-section" aria-labelledby="core-title">
          <div className="bots-section-head"><h2 id="core-title">{t('bots.home.core')}</h2></div>
          <div className="collection-tiles">{core.map(c => <CollectionTile key={c.id} collection={c} stars={stars} />)}</div>
        </section>
      </>}
    </section>
  );
}

/** The event leading the home page: live with its countdown and crest progress, or coming soon. */
function EventHero({ event, kept, date, onOpen }: { event: BotCollection; kept: number; date: (time: number) => string; onOpen: (bot?: string) => void }) {
  const { t } = useTranslation('play');
  const isLive = event.status === 'live';
  // Five figures fanned out, from across the ratings.
  const step = Math.max(1, Math.floor(event.bots.length / 5));
  const fan = event.bots.filter((_, i) => i % step === 0).slice(0, 5);
  return (
    <section className="event-hero" data-theme={event.theme} aria-labelledby="event-title">
      <div className="event-hero-text">
        <span className="event-kicker">{isLive && <i className="live-dot" />}{t(isLive ? 'bots.events.liveKicker' : 'bots.events.soonKicker')}</span>
        <h2 id="event-title">{event.title}</h2>
        <p>{isLive ? t('bots.events.blurbLive', { count: event.bots.length, date: date(event.end!), need: event.need })
          : t('bots.events.blurbSoon', { count: event.bots.length, date: date(event.start! + 1) })}</p>
        <EventClock until={isLive ? event.end! : event.start!} label={t(isLive ? 'bots.events.leavesIn' : 'bots.events.arrivesIn')} />
        {isLive && <div className="event-progress">
          <span className="meter"><i style={{ width: `${Math.min(100, Math.round(kept / event.need! * 100))}%` }} /></span>
          <small>{t('bots.events.progress', { count: kept, need: event.need, total: event.bots.length })}</small>
        </div>}
        <div className="event-actions">
          <button type="button" className="event-play" onClick={() => onOpen()}>{t(isLive ? 'bots.events.play' : 'bots.events.preview')}</button>
          <button type="button" className="event-all" onClick={() => onOpen()}>{t('bots.events.seeAll', { count: event.bots.length })}</button>
        </div>
      </div>
      <div className="event-fan">{fan.map((bot, i) => (
        <button key={bot.id} type="button" className={`fan-card fan-${i}`} aria-label={bot.name} onClick={() => onOpen(bot.id)}>
          <img src={botPicture(bot)} alt="" className={isLive ? '' : 'waiting'} />
        </button>
      ))}</div>
    </section>
  );
}

/** "Show more" under a list that is not all shown yet, saying how many are left. */
function ShowMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  const { t } = useTranslation('play');
  if (shown >= total) return null;
  return <button type="button" className="bots-button show-more" onClick={onMore}>{t('bots.home.more', { count: total - shown })}</button>;
}

/** A collection on the home page: a few faces, its name and how many you have beaten. */
function CollectionTile({ collection, stars }: { collection: BotCollection; stars: Record<string, number> }) {
  const { t } = useTranslation('play');
  const won = collection.bots.filter(b => beaten(stars, b)).length;
  return (
    <Link className="collection-tile" to={collectionPath(collection.id)}>
      <span className="tile-faces">{faces(collection, 3).map(bot => <img key={bot.id} src={botPicture(bot)} alt="" />)}</span>
      <span className="tile-text"><strong>{collection.title}</strong>
        <small>{collection.bots.length ? t('bots.home.tileCount', { count: collection.bots.length, won }) : t(`bots.home.tileEmpty.${collection.id}`, { defaultValue: '' })}</small></span>
      <span className="tile-arrow" aria-hidden>›</span>
    </Link>
  );
}
