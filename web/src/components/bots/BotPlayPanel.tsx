// The lobby's play panel: the chosen bot large, how it plays, and the game setup with Start. Event bots
// that are locked (a coming event, or one that ended before you beat them) say when they are back.
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { botPicture, coachRating, isPlayable, type Bot } from '../../data/bots';
import { legendVenue } from '../../data/legends';
import type { BotCollection } from '../../data/collections';
import { api } from '../../lib/api';
import { START_FEN } from '../../lib/format';
import { loadStars } from '../../lib/stars';
import { LEVELS, PHASE_ELO_RANGE, PHASES, savePlay, type PhaseElo } from '../../lib/storage';
import { useEngines, useGameData } from '../../state/AppData';
import type { MasterInfo } from '../../types';
import { Stars } from '../Reward';
import { Segments } from '../Segments';
import { daysUntil } from './EventClock';

type Side = 'White' | 'Black' | 'Random';
const BOOK_OPTIONS = ['none', 'repertoire', 'drill'] as const;
const STYLE_NAMES = ['aggression', 'accuracy', 'endgame'] as const;

function Pill({ active, onClick, children, disabled, title }: { active: boolean; onClick?: () => void; children: ReactNode; disabled?: boolean; title?: string }) {
  return <button type="button" aria-pressed={active} className={active ? 'selected' : ''} onClick={onClick} disabled={disabled} title={title}>{children}</button>;
}

/** The stars a bot's card and panel show: Stockfish's are per skill level, and an event's bots (on its
 *  rating ladder) keep their own, apart from the same bot at its usual rating. */
export const starsKey = (bot: Bot, level: number, collection?: BotCollection) =>
  bot.id === 'sf18' ? `sf18-l${level}` : collection?.kind === 'season' ? `${collection.id}:${bot.id}` : bot.id;

interface PanelProps {
  bot: Bot;
  collection?: BotCollection;
  /** Why the bot can't be played now, if it can't. */
  lock?: 'soon' | 'ended' | null;
  level: number;
  onLevel: (level: number) => void;
  /** A Venezuelan abroad: where they came from and where they live now. */
  move?: ReactNode;
}

export function BotPlayPanel({ bot, collection, lock, level, onLevel, move }: PanelProps) {
  const { t, i18n } = useTranslation('play');
  const navigate = useNavigate();
  const { games, engineAvailable } = useGameData();
  const { loaded, installed: installedIds } = useEngines();
  // undefined while the registry loads, so Stockfish keeps its old always-playable behavior.
  const installed = loaded ? installedIds : undefined;
  const rating = Number(games.find(g => g.user_rating)?.user_rating) || null;
  const [color, setColor] = useState<Side>('White');
  const [byPhase, setByPhase] = useState(false);
  const [phaseElo, setPhaseElo] = useState<PhaseElo | null>(null);
  useEffect(() => setPhaseElo(null), [bot.id]);

  const playableBot = isPlayable(bot, installed);
  const playable = !lock && playableBot && (bot.engineId && bot.engineId !== 'stockfish' ? true : engineAvailable);
  const elo = bot.coach ? coachRating(rating) : bot.elo;
  const stars = loadStars()[starsKey(bot, level, collection)] ?? 0;
  // A strength per phase needs a bot that plays at a rating: not Stockfish's skill levels, not a model.
  const phaseable = bot.id !== 'sf18' && !bot.modelId && bot.elo > 0 && playableBot;
  const phases: PhaseElo = phaseElo ?? { opening: elo, middlegame: elo, endgame: elo };
  const kind = bot.id === 'sf18' ? t('lobby.engineLevel', { level })
    : bot.avatar || playableBot ? bot.kind : t('lobby.kindDesignPreview', { kind: bot.kind.split(' · ')[0] });
  const diff = rating && bot.elo > 0 && bot.id !== 'sf18' ? elo - rating : null;
  const season = collection?.kind === 'season' ? collection : undefined;
  const month = (time: number) => new Date(time).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });

  function start() {
    if (!playable) return;
    const side = color === 'Random' ? (Math.random() < 0.5 ? 'White' : 'Black') : color;
    const otherEngine = bot.engineId && bot.engineId !== 'stockfish' ? bot.engineId : undefined;
    savePlay({ initialFen: START_FEN, moves: [], playerColor: side === 'White' ? 'white' : 'black', level, result: null,
      ...(bot.avatar || otherEngine || bot.masterId ? { botId: bot.id } : {}),
      ...(bot.masterId ? { masterId: bot.masterId, elo: bot.elo, botName: bot.name } : {}),
      ...(bot.avatar ? { elo, botName: bot.name } : {}),
      ...(otherEngine ? { engineId: otherEngine, botName: bot.name } : {}),
      ...(bot.modelId ? { modelId: bot.modelId } : {}), ...(bot.nodes ? { nodes: bot.nodes } : {}),
      ...(phaseable && byPhase ? { phaseElo: phases } : {}), ...(bot.coach ? { coached: true } : {}),
      // An event bot plays in its costume; a win while the event is on keeps it.
      ...(bot.outfit && bot.avatar ? { outfit: bot.avatar } : {}), ...(season?.status === 'live' ? { event: season.id } : {}),
      ...(bot.regular ? { costume: bot.name } : {}),
      ...(season ? { starsKey: starsKey(bot, level, season) } : {}) });
    navigate('/play', { state: { started: Date.now() } });
  }

  const venue = bot.masterId ? legendVenue(bot.masterId) : undefined;
  return (
    <aside id="bot-setup" className="bot-panel" aria-label={t('lobby.setupLabel')} aria-live="polite">
      <span className={`bot-stage${venue ? ' has-venue' : ''}${lock ? ' locked' : ''}`}>
        {venue && <img className="bot-stage-venue" src={venue} alt="" />}
        <img src={botPicture(bot)} alt={bot.name} />
      </span>
      <div className="bot-panel-title">
        <strong>{bot.name}</strong>
        <span className="bot-detail-rating">{bot.id === 'sf18' ? `L${level}` : elo}</span>
      </div>
      {bot.outfit && season && <span className="bot-outfit">{bot.regular ? t('bots.panel.playedBy', { name: bot.regular }) : t('bots.panel.wearing', { title: season.title })}</span>}
      {move && <p className="bot-move">{move}</p>}
      {bot.hello && <p className="bot-hello">“{bot.hello}”</p>}
      {/* With the move above, "chef · Valencia → Madrid" only needs "chef". */}
      <div className="bot-panel-row"><span>{t('bots.panel.plays')}</span><b>{move ? kind.replace(/\s*·[^·]*→[^·]*$/, '') : kind}</b></div>
      {playableBot && !bot.coach && (
        <div className="bot-panel-row bot-best">
          <span>{t('lobby.yourBest')}</span><Stars count={stars} size={18} label={t('lobby.bestStars', { count: stars })} />
          {diff !== null && <b className={diff > 150 ? 'above' : diff < -150 ? 'below' : ''}>{diff === 0 ? t('bots.panel.yourLevel') : t('bots.panel.vsYou', { diff: `${diff > 0 ? '+' : '−'}${Math.abs(diff)}` })}</b>}
        </div>
      )}
      {lock ? (
        <div className="bot-locked">
          <strong>{lock === 'soon'
            ? collection!.status === 'later' ? t('bots.events.arrivesMonth', { when: month(collection!.start!) }) : t('bots.locked.soon', { count: daysUntil(collection!.start!) })
            : t('bots.locked.returns', { when: month(collection!.start!) })}</strong>
          <span>{lock === 'soon' ? t('bots.locked.soonNote') : t('bots.locked.endedNote')}</span>
        </div>
      ) : (
        <div className="bot-game-options">
          {bot.id === 'sf18' && <>
            <label className="bot-field-label">{t('lobby.engineStrength')}</label>
            <Segments className="bots-segments bot-levels">{LEVELS.map(l => <Pill key={l} active={level === l} onClick={() => onLevel(l)}>{l}</Pill>)}</Segments>
          </>}
          <label className="bot-field-label">{t('lobby.timeControl')}</label>
          <Segments>{['10+0', '5+0', '25+10', '∞'].map(time => (
            <Pill key={time} active={time === '∞'} disabled={time !== '∞'} title={time === '∞' ? undefined : t('lobby.timedNotConnected')}>{time}</Pill>
          ))}</Segments>
          <label className="bot-field-label">{t('lobby.playAs')}</label>
          <Segments>{(['White', 'Black', 'Random'] as Side[]).map(side => <Pill key={side} active={color === side} onClick={() => setColor(side)}>{t(`lobby.sides.${side}`)}</Pill>)}</Segments>
          {bot.coach && <p className="bot-option-note">{t('lobby.coachOnNote')}</p>}
          {!playable && <p className="bot-preview-note">{playableBot ? t('lobby.installStockfish') : t('lobby.designPreview')}</p>}
          <button type="button" className="bots-button solid bot-start" disabled={!playable} onClick={start}>{playable ? t('lobby.start') : t('lobby.previewOnly')}</button>
          {!playableBot && <button type="button" className="bot-stockfish-link" onClick={() => navigate('/play/bots/engines?bot=sf18')}>{t('lobby.chooseStockfish')}</button>}
          <details className="bot-more">
            <summary>{t('bots.panel.more')}</summary>
            <p className="bot-desc">{bot.desc}</p>
            {bot.id === 'sf18'
              ? <div className="bot-engine-available"><i />{engineAvailable ? t('lobby.stockfishInstalled') : t('lobby.stockfishUnavailable')}</div>
              : bot.master ? <LegendRecord master={bot.master} />
              : bot.style.map((value, index) => (
                <div className="bot-style" key={index}><span>{t(`lobby.styles.${STYLE_NAMES[index]}`)}</span>
                  <i><b className={`style-${index}`} style={{ width: `${value}%` }} /></i><small>{value}%</small></div>
              ))}
            <p className="bot-data-note">{bot.id === 'sf18' ? t('lobby.notes.engine') : bot.master ? t('legend.note', { name: bot.name, elo: bot.elo }) : bot.avatar ? t(elo < 1150 ? 'lobby.notes.characterSlips' : 'lobby.notes.character', { elo }) : playableBot ? t('lobby.notes.engine') : t('lobby.notes.preview')}</p>
            <label className="bot-field-label">{t('lobby.opening')}</label>
            <Segments>{BOOK_OPTIONS.map((option, index) => (
              <Pill key={option} active={index === 0} disabled={index > 0} title={index ? t('lobby.openingNotConnected') : undefined}>{t(`lobby.openings.${option}`)}</Pill>
            ))}</Segments>
            {phaseable && <>
              <label className="bot-field-label">{t('lobby.strengthByPhase')}</label>
              <Segments>
                <Pill active={!byPhase} onClick={() => setByPhase(false)}>{t('lobby.sameStrength', { elo })}</Pill>
                <Pill active={byPhase} onClick={() => setByPhase(true)}>{t('lobby.perPhase')}</Pill>
              </Segments>
              {byPhase && <div className="bot-phase-sliders">
                {PHASES.map(phase => (
                  <label key={phase}>
                    <span>{t(`lobby.phases.${phase}`)}</span>
                    <input type="range" min={PHASE_ELO_RANGE[0]} max={Math.min(PHASE_ELO_RANGE[1], 2800)} step={50} value={phases[phase]}
                      onChange={e => setPhaseElo({ ...phases, [phase]: Number(e.target.value) })} />
                    <b>{phases[phase]}</b>
                  </label>
                ))}
                <p className="bot-option-note">{t('lobby.perPhaseNote')}</p>
              </div>}
            </>}
            <div className="bot-option-unavailable"><span>{t('lobby.ladder')}</span><span>{t('lobby.unrated')}</span></div>
          </details>
        </div>
      )}
    </aside>
  );
}

/** Training a bot from your games: designed, not connected yet. */
export function BotTraining({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('play');
  const navigate = useNavigate();
  const { games } = useGameData();
  return (
    <aside id="bot-setup" className="bot-panel bot-training" aria-label={t('lobby.trainBot')}>
      <div className="bot-panel-title"><strong>{t('lobby.trainBot')}</strong><button type="button" className="bots-button" onClick={onClose}>{t('lobby.close')}</button></div>
      <p>{t('lobby.trainingIntro')}</p>
      <div className="bot-training-source"><Trans t={t} i18nKey="lobby.trainingSource" count={games.length} components={{ strong: <strong /> }} /></div>
      <p>{t('lobby.trainingNote')}</p>
      <button type="button" className="bots-button solid" disabled>{t('lobby.trainingNotConnected')}</button>
      <button type="button" className="bots-button" onClick={() => navigate('/play/bots/engines?bot=sf18')}>{t('lobby.playStockfishInstead')}</button>
    </aside>
  );
}

/** A legend's results in their games, and (once their book is read) the first moves they favour. */
function LegendRecord({ master }: { master: MasterInfo }) {
  const { t } = useTranslation('play');
  const [profile, setProfile] = useState<MasterInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setProfile(null);
    setFailed(false);
    // Reading the book also warms it, so the first move of the game is instant.
    api<{ master: MasterInfo }>('api/masters/prepare', { id: master.id })
      .then(data => { if (live) setProfile(data.master); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [master.id]);
  const decided = master.wins + master.draws + master.losses || 1;
  const rows: [string, number, string][] = [[t('legend.wins'), master.wins, 'wins'], [t('legend.draws'), master.draws, 'draws'], [t('legend.losses'), master.losses, 'losses']];
  return (
    <div className="legend-record">
      {rows.map(([label, count, kind]) => (
        <div className="bot-style" key={label}><span>{label}</span>
          <i><b className={`record-${kind}`} style={{ width: `${Math.round(count / decided * 100)}%` }} /></i><small>{Math.round(count / decided * 100)}%</small></div>
      ))}
      <p className="legend-openings">{profile
        ? <>{t('legend.favourite')} <b>{profile.openings?.white.map(([san, share]) => `1.${san} ${share}%`).join(' · ')}</b></>
        : failed ? t('legend.unreadable') : t('legend.reading', { count: master.games, games: master.games.toLocaleString() })}</p>
    </div>
  );
}
