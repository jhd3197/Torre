// /play/bots/:collection — one collection: its hero (an event's countdown and crest, a country's flag),
// its bots to sort and pick from, and the play panel. ?bot= picks a bot; ?train=1 opens training.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { botPicture, coachRating, type Bot } from '../data/bots';
import { VENEZUELA_FLAG, keptCount, lockOf, moveOf, newHomeOf, type BotCollection, type CollectionKind } from '../data/collections';
import { BotPlayPanel, BotTraining, starsKey } from '../components/bots/BotPlayPanel';
import { BotTile, Flag } from '../components/bots/BotTile';
import { EventClock, daysUntil } from '../components/bots/EventClock';
import { LegendHall } from '../components/LegendHall';
import { Segments } from '../components/Segments';
import { useBotCollections } from '../hooks/useBotCollections';
import { isKept, loadEvents } from '../lib/events';
import { loadStars } from '../lib/stars';
import { collectionPath } from './BotsHomePage';

type Sort = 'easy' | 'near' | 'hard';
const GROUPS: CollectionKind[] = ['season', 'country', 'theme', 'core'];

export function BotCollectionPage() {
  const { t, i18n } = useTranslation('play');
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { collections, rating, masters } = useBotCollections();
  const [sort, setSort] = useState<Sort>('easy');
  const [hideBeaten, setHideBeaten] = useState(false);
  const [level, setLevel] = useState(4);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const stars = loadStars();
  const progress = loadEvents();

  useEffect(() => {
    document.body.dataset.page = 'bots';
    return () => { document.body.dataset.page = 'board'; };
  }, []);
  useEffect(() => { setPickerOpen(false); setHideBeaten(false); }, [id]);

  const collection = collections.find(c => c.id === id);
  const target = rating ?? 1180;
  const ratingOf = (bot: Bot) => bot.coach ? coachRating(rating) : bot.elo;
  const lockFor = (bot: Bot) => collection ? lockOf(collection, bot, progress) : null;
  const isBeaten = (bot: Bot) => collection?.kind === 'season' ? isKept(collection.id, bot.id, progress) : (stars[starsKey(bot, level, collection)] ?? 0) >= 3;
  const list = useMemo(() => {
    const bots = (collection?.bots ?? []).slice();
    const distance = (bot: Bot) => Math.abs(ratingOf(bot) - target);
    bots.sort((a, b) => sort === 'hard' ? b.elo - a.elo : sort === 'near' ? distance(a) - distance(b) : a.elo - b.elo);
    return bots;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, sort, target]);
  if (!collection) return <Navigate to="/play/bots" replace />;

  const shown = hideBeaten ? list.filter(bot => !isBeaten(bot)) : list;
  const training = params.get('train') === '1';
  const wanted = params.get('bot');
  const selected = list.find(bot => bot.id === wanted)
    ?? list.filter(bot => !lockFor(bot) && !bot.coach).sort((a, b) => Math.abs(ratingOf(a) - target) - Math.abs(ratingOf(b) - target))[0] ?? list[0];
  const choose = (bot: Bot) => setParams({ bot: bot.id }, { replace: true });
  const same = collections.filter(c => c.kind === collection.kind);
  const at = same.indexOf(collection);
  const sibling = (step: number) => same[(at + step + same.length) % same.length];
  const won = collection.kind === 'season' ? keptCount(collection, progress) : collection.bots.filter(isBeaten).length;
  const month = (time: number) => new Date(time).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });

  // Venezuelans abroad: tagged with where they came from on their new country's page, and with
  // where they live now on Venezuela's. The only bots that are on two pages.
  const abroad = new Set(collection.abroad ?? []);
  function badgeOf(bot: Bot) {
    const move = moveOf(bot);
    if (collection!.movedHere?.includes(bot.id)) return <><Flag code={VENEZUELA_FLAG} />{move ? t('bots.collection.from', { from: move.from }) : t('bots.collection.venezuelan')}</>;
    if (abroad.has(bot.id)) {
      const home = newHomeOf(collections, bot.id);
      // Mixed in with everyone at home: the flag and the city say where they live now.
      return <>{home?.flag && <Flag code={home.flag} />}{move?.to ?? home?.title}</>;
    }
    return undefined;
  }
  const moveLine = (bot: Bot) => {
    const move = (collection.movedHere?.includes(bot.id) || abroad.has(bot.id)) && moveOf(bot);
    const now = newHomeOf(collections, bot.id);
    // Each line opens that country on this bot; the one for the page you are on is plain text.
    const line = (target: string | undefined, content: ReactNode) => target && target !== collection.id
      ? <Link to={collectionPath(target, bot.id)}>{content}</Link> : <span>{content}</span>;
    return move ? <>
      {line('venezuela', <><Flag code={VENEZUELA_FLAG} />{t('bots.collection.movedFrom', { from: move.from })}</>)}
      {line(now?.id, <>{now?.flag && <Flag code={now.flag} />}{t('bots.collection.movedTo', { to: move.to })}</>)}
    </> : undefined;
  };

  function card(bot: Bot) {
    const lock = lockFor(bot);
    return (
      <BotTile key={bot.id} bot={bot} rating={bot.id === 'sf18' ? `L${level}` : ratingOf(bot)} selected={bot.id === selected?.id && !training}
        stars={!bot.coach && bot.elo > 0 ? stars[starsKey(bot, level, collection)] ?? 0 : undefined} starsLabel={t('lobby.bestStars', { count: stars[starsKey(bot, level, collection)] ?? 0 })}
        beaten={isBeaten(bot)} locked={!!lock} title={bot.kind}
        badge={badgeOf(bot)}
        onClick={() => choose(bot)} />
    );
  }

  const q = pickerQuery.trim().toLowerCase();
  return (
    <section id="bot-lobby" className="bots-collection" aria-label={t('lobby.label')}>
      <nav className="collection-nav" aria-label={t('bots.collection.navLabel')}>
        <Link className="bots-button back" to="/play/bots">‹ {t('bots.collection.allBots')}</Link>
        <span className="collection-group">{t(`bots.groups.${collection.kind}`)}</span>
        <span className="collection-slash" aria-hidden>/</span>
        <button type="button" className={`bots-button picker${pickerOpen ? ' open' : ''}`} aria-expanded={pickerOpen} onClick={() => setPickerOpen(!pickerOpen)}>
          {collection.title} <span aria-hidden>▾</span>
        </button>
        {same.length > 1 && <span className="collection-siblings">
          <button type="button" className="bots-button" onClick={() => navigate(collectionPath(sibling(-1).id))}>‹ {sibling(-1).title}</button>
          <button type="button" className="bots-button" onClick={() => navigate(collectionPath(sibling(1).id))}>{sibling(1).title} ›</button>
        </span>}
        {pickerOpen && <>
          <div className="picker-scrim" onClick={() => setPickerOpen(false)} />
          <div className="collection-picker" role="dialog" aria-label={t('bots.collection.pickerLabel')}>
            <input type="search" autoFocus placeholder={t('bots.collection.pickerSearch')} value={pickerQuery} onChange={e => setPickerQuery(e.target.value)} />
            {GROUPS.map(kind => {
              const items = collections.filter(c => c.kind === kind && (!q || c.title.toLowerCase().includes(q)));
              return items.length ? <div key={kind} className="picker-group">
                <span className="picker-group-label">{t(`bots.groups.${kind}`)} · {items.length}</span>
                <div className="picker-items">{items.map(c => (
                  <Link key={c.id} to={collectionPath(c.id)} className={`picker-item${c.id === collection.id ? ' current' : ''}`} onClick={() => setPickerOpen(false)}>
                    <span className="picker-face">{c.bots[0] && <img src={botPicture(c.bots.find(b => b.avatar) ?? c.bots[0])} alt="" />}{c.flag && <Flag code={c.flag} className="flag picker-flag" />}</span>
                    <span className="picker-text"><strong>{c.title}</strong><small className={c.status === 'live' ? 'live' : ''}>{pickerMeta(c)}</small></span>
                  </Link>
                ))}</div>
              </div> : null;
            })}
          </div>
        </>}
      </nav>

      <CollectionHero collection={collection} won={won} month={month} />

      <div className="collection-body">
        <div className="collection-main">
          {collection.id !== 'legends' && <div className="collection-tools">
            <Segments aria-label={t('bots.collection.sortLabel')}>
              {(['easy', 'near', 'hard'] as Sort[]).map(key => (
                <button key={key} type="button" aria-pressed={sort === key} className={sort === key ? 'selected' : ''} onClick={() => setSort(key)}>{t(`bots.collection.sort.${key}`)}</button>
              ))}
            </Segments>
            <button type="button" className="hide-beaten" role="switch" aria-checked={hideBeaten} onClick={() => setHideBeaten(!hideBeaten)}>
              <span className="switch" aria-hidden><i /></span>{t('bots.collection.hideBeaten')}
            </button>
            <span className="collection-count">{t('bots.collection.count', { shown: shown.length, total: list.length })}</span>
          </div>}
          {collection.id === 'legends'
            ? <LegendHall legends={list} missing={masters.missing} fill={masters.fill} card={card} onAdded={masters.replace} />
            : <div className="bots-grid">
              {collection.id === 'yours' && <button type="button" className="bot-card bot-train-tile" onClick={() => setParams({ train: '1' }, { replace: true })}>
                <span className="bot-picture"><img src="art/yours/train.webp" alt="" loading="lazy" /></span>
                <strong>{t('lobby.trainNewBot')}</strong><small>{t('lobby.trainNewBotDetail')}</small></button>}
              {shown.map(card)}
            </div>}
          {hideBeaten && !shown.length && <p className="bots-empty">{t('bots.collection.allBeaten')}</p>}
        </div>
        {training ? <BotTraining onClose={() => setParams({}, { replace: true })} />
          : selected && <BotPlayPanel key={`${collection.id}-${selected.id}`} bot={selected} collection={collection} lock={lockFor(selected)} level={level} onLevel={setLevel} move={moveLine(selected)} />}
      </div>
    </section>
  );

  function pickerMeta(c: BotCollection) {
    if (c.kind === 'season') {
      const count = keptCount(c, progress);
      return c.status === 'live' ? t('bots.events.liveMeta', { count, total: c.bots.length })
        : c.status === 'soon' ? t('bots.events.inDays', { count: daysUntil(c.start!) })
        : c.status === 'later' ? t('bots.events.arrivesMonth', { when: month(c.start!) }) : t('bots.events.endedMeta', { count });
    }
    return t('bots.collection.beatenMeta', { count: c.bots.filter(b => (stars[b.id] ?? 0) >= 3).length, total: c.bots.length });
  }
}

/** The top of a collection: an event in its colours with its clock and crest, a country with its flag. */
function CollectionHero({ collection, won, month }: { collection: BotCollection; won: number; month: (time: number) => string }) {
  const { t, i18n } = useTranslation('play');
  const total = collection.bots.length;
  if (collection.kind === 'season') {
    // An event further off reads like one coming soon, its clock just longer.
    const status = collection.status === 'later' ? 'soon' : collection.status!;
    const date = (time: number) => new Date(time).toLocaleDateString(i18n.language, { month: 'long', day: 'numeric' });
    return (
      <section className="collection-hero event-hero" data-theme={collection.theme} aria-labelledby="collection-title">
        <div className="event-hero-text">
          <span className="event-kicker">{status === 'live' && <i className="live-dot" />}{t(`bots.events.${status}Kicker`)}</span>
          <h2 id="collection-title">{collection.title}</h2>
          <p>{status === 'live' ? t('bots.events.blurbLive', { count: total, date: date(collection.end! - 1), need: collection.need })
            : status === 'soon' ? t('bots.events.blurbSoon', { count: total, date: date(collection.start!) })
            : t('bots.events.blurbEnded', { count: total })}</p>
          <div className="event-progress">
            <span className="meter"><i style={{ width: `${Math.min(100, Math.round(won / (status === 'live' ? collection.need! : total) * 100))}%` }} /></span>
            <small>{status === 'live' ? t('bots.events.progress', { count: won, need: collection.need, total })
              : status === 'soon' ? t('bots.events.lockedUntil', { count: total }) : t('bots.events.youKept', { count: won, total })}</small>
          </div>
        </div>
        {status === 'ended'
          ? <p className="event-note">{t('bots.events.returnsNote', { when: month(collection.start!), count: won })}</p>
          : <EventClock until={status === 'live' ? collection.end! : collection.start!} label={t(status === 'live' ? 'bots.events.leavesIn' : 'bots.events.arrivesIn')} />}
      </section>
    );
  }
  return (
    <section className="collection-hero event-hero plain" aria-labelledby="collection-title">
      <div className="event-hero-text">
        <span className="event-kicker">{t(`bots.collection.kicker.${collection.kind}`)}</span>
        <h2 id="collection-title">{collection.flag && <Flag code={collection.flag} className="flag hero-flag" />}{collection.title}</h2>
        <p>{collection.abroad ? t('bots.collection.blurb.venezuela', { home: total - collection.abroad.length, abroad: collection.abroad.length })
          : t(`bots.collection.blurb.${collection.kind === 'core' ? collection.id : collection.kind}`, { count: total, title: collection.title })}</p>
        {total > 0 && <div className="event-progress">
          <span className="meter"><i style={{ width: `${Math.round(won / total * 100)}%` }} /></span>
          <small>{t('bots.collection.beatenOf', { count: won, total })}</small>
        </div>}
      </div>
      {collection.neighbour && <p className="event-note">{(() => {
        const move = moveOf(collection.neighbour);
        return move ? t('bots.collection.neighbourMoved', { name: collection.neighbour.name, from: move.from, to: move.to })
          : t('bots.collection.neighbourNote', { name: collection.neighbour.name, title: collection.title });
      })()}</p>}
      {collection.abroad && <p className="event-note">{t('bots.collection.venezuelaNote', { count: collection.abroad.length })}</p>}
    </section>
  );
}
