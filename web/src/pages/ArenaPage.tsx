// /arena — the Arena: two players fight a match while you watch. Engines, Maia models,
// legends (a master's own opening moves, then Stockfish at their peak) and AI language models
// (through Prompture's chess harness, which only lets them pick legal moves) can all take a seat.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChessBoard } from '../components/ChessBoard';
import { EvalBar } from '../components/workspace/EvalBar';
import { MoveList } from '../components/workspace/MoveList';
import { engineFigure } from '../data/bots';
import { ERAS, byHistory, hallArt, legendEra, legendFigure, legendPose } from '../data/legends';
import { useMasters } from '../hooks/useMasters';
import { usePlanning } from '../hooks/usePlanning';
import { usePoll } from '../hooks/usePoll';
import { ArenaLadder } from '../components/ArenaLadder';
import { api } from '../lib/api';
import { START_FEN } from '../lib/format';
import { explorePath } from '../lib/routes';
import { GRADES, emptyGrades, gradeIcon, gradeOf } from '../lib/grades';
import { useEngines } from '../state/AppData';
import { eloForNodes, NODE_LEVELS } from '../lib/nodeStrength';
import type { AnalyzedMove, ArenaAiEffort, ArenaGame, ArenaPlayer, ArenaTally, BoardState, EngineLine, ArenaMatch, ArenaMoveNote, ArenaPlayerSpec, ArenaSettings, ArenaStatus, ArenaSummary, EngineInfo, MasterInfo } from '../types';
import { Segments } from '../components/Segments';

/** A watched match shows each move as it lands; the first check after a start comes a little sooner. */
const ARENA_POLL_MS = 500;
const ARENA_FIRST_POLL_MS = 400;
const GAME_COUNTS = [2, 4, 10, 20, 100] as const;
const MOVETIMES = [0.1, 0.3, 1, 3] as const;
/** Ratings an engine with strength options can be held to; 0 is full strength. */
const RATINGS = [0, 800, 1200, 1500, 1800, 2000, 2200, 2500, 2800] as const;
/** AI models offered first in the picker; any Prompture "provider/model" can be typed in. */
const AI_FEATURED = ['claude/claude-fable-5-1', 'openai/gpt-6-astra'] as const;
/** The harness's help levels (arena.AI_LEVELS) and the reasoning efforts a provider takes. */
const AI_LEVELS = [0, 1, 2, 3, 4, 5] as const;
const AI_EFFORTS: ArenaAiEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/** Dollar caps on what the AI players may spend in a match; 0 is no cap. */
const COST_CAPS = [5, 20, 50, 0] as const;

/** A game's opening: a named book line ("Ruy Lopez (C84)") or one of the varied set's own names. */
function openingLabel(game: { opening: string | null; openingName?: string; eco?: string }, t: (key: string) => string) {
  if (game.openingName) return game.eco ? `${game.openingName} (${game.eco})` : game.openingName;
  return game.opening ? t(`openings.${game.opening}`) : '';
}

/** A seat choice: what the select holds ("engine:stockfish", "model:lc0:maia-1500", "master:Carlsen",
 *  "ai:claude/claude-fable-5-1"). An AI seat also has the harness's help level and a reasoning effort. */
interface Seat { key: string; elo: number; nodes?: number; level?: number; effort?: ArenaAiEffort }

/** The model of an AI seat ("ai:ollama/llama3.2:3b" holds colons of its own), or null. */
const aiModel = (key: string) => (key.startsWith('ai:') ? key.slice(3) : null);
/** An AI player's figure: a robot of its own per provider. */
const aiFigure = (model: string) => engineFigure(`ai-${model.split('/')[0]}`);

function specOf(seat: Seat): ArenaPlayerSpec {
  const model = aiModel(seat.key);
  if (model) return { ai: { model, level: seat.level ?? 0, ...(seat.effort ? { effort: seat.effort } : {}) } };
  const [kind, a, b] = seat.key.split(':');
  if (kind === 'master') return { masterId: a };
  if (kind === 'model') return { engineId: a, modelId: b };
  return { engineId: a, ...(seat.elo ? { elo: seat.elo } : {}), ...(seat.nodes ? { nodes: seat.nodes } : {}) };
}

/** Engines that can be held to a rating (Stockfish always can). */
const ratable = (engine: EngineInfo | undefined) => !!engine && (engine.id === 'stockfish' || engine.capabilities.limit_strength || engine.capabilities.skill_level);

/** A result from the first player's point of view: 1, ½ or 0 (– for a game the cost cap cut short). */
function pointsFor(game: ArenaGame, player: 0 | 1): string {
  if (game.result === '*') return '–';
  if (game.result === '1/2-1/2') return '½';
  const whiteWon = game.result === '1-0';
  return (game.white === player) === whiteWon ? '1' : '0';
}

const half = (score: number) => Number.isInteger(score) ? String(score) : `${Math.floor(score) || ''}½`;
const dollars = (amount: number) => `$${amount < 1 ? amount.toFixed(3) : amount.toFixed(2)}`;

/** The judge's score as an engine line, which is what EvalBar reads. */
function judgeLine(judge: { cp: number | null; mate: number | null } | null | undefined): EngineLine | null {
  if (!judge) return null;
  return { cp: judge.cp ?? 0, mate: judge.mate, moves: [], uci: [] };
}

/** White's chance to win, 0–100, from the judge's score (the usual logistic on centipawns). */
function whiteChance(board: BoardState, line: EngineLine | null): number | null {
  if (board.result) return board.result === '1-0' ? 100 : board.result === '0-1' ? 0 : 50;
  if (!line) return null;
  if (line.mate !== null) return line.mate > 0 ? 100 : 0;
  return Math.round(100 / (1 + 10 ** (-line.cp / 400)));
}

function evalText(value: ArenaMoveNote['eval'] | null | undefined): string | null {
  if (!value) return null;
  if (value.mate !== null && value.mate !== undefined) return `#${value.mate}`;
  if (value.cp === null || value.cp === undefined) return null;
  return `${value.cp > 0 ? '+' : ''}${(value.cp / 100).toFixed(1)}`;
}

export function ArenaPage() {
  const { t } = useTranslation('arena');
  const { engines, loaded: enginesLoaded } = useEngines();
  const { masters, missing, loaded: mastersLoaded, replace: replaceMasters } = useMasters();
  const [status, setStatus] = useState<ArenaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seats, setSeats] = useState<[Seat, Seat]>([{ key: '', elo: 0 }, { key: '', elo: 0 }]);
  const [settings, setSettings] = useState<ArenaSettings>({ games: 2, movetime: 0.3, openings: 'start', pace: 'watch', costCap: 20 });
  const [starting, setStarting] = useState(false);
  const [opened, setOpened] = useState<ArenaMatch | null>(null);
  // After a match, its result stays up until you ask for a new one.
  const [setupOpen, setSetupOpen] = useState(false);
  const { schedule, cancel, signal } = usePoll();

  const installed = useMemo(() => engines.filter(engine => engine.installed), [engines]);
  const models = useMemo(() => installed.flatMap(engine => (engine.models ?? []).filter(model => model.installed).map(model => ({ engine, model }))), [installed]);
  const roster: Roster = { engines: installed, models, masters };

  // Fill the seats with something sensible once the lists arrive: a legend against Stockfish if there is one.
  useEffect(() => {
    if (!enginesLoaded || !mastersLoaded || seats[0].key) return;
    const first = masters.find(m => m.id === 'Carlsen') ?? masters[0];
    setSeats([first ? { key: `master:${first.id}`, elo: 0 } : { key: 'engine:stockfish', elo: 1500 }, { key: 'engine:stockfish', elo: first ? 2500 : 2000 }]);
  }, [enginesLoaded, mastersLoaded, masters, seats]);

  const refresh = useCallback(async () => {
    cancel();
    const live = signal();
    try {
      const next = await api<ArenaStatus>('api/arena', undefined, live);
      if (live.aborted) return;
      setStatus(next);
      if (next.running) schedule(refresh, ARENA_POLL_MS);
    } catch (problem) { if (!live.aborted) setError((problem as Error).message); }
  }, [cancel, schedule, signal]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function start() {
    setStarting(true);
    setError(null);
    setOpened(null);
    setSetupOpen(false);
    try {
      // The spending cap only means something with an AI player at the board.
      const { costCap, ...rest } = settings;
      setStatus(await api<ArenaStatus>('api/arena/start', { players: seats.map(specOf), ...rest, ...(hasAi ? { costCap: costCap || null } : {}) }));
      schedule(refresh, ARENA_FIRST_POLL_MS);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    try { setStatus(await api<ArenaStatus>('api/arena/stop', {})); } catch (problem) { setError((problem as Error).message); }
  }

  async function open(summary: ArenaSummary) {
    setSetupOpen(false);
    try { setOpened(await api<ArenaMatch>(`api/arena/matches/${summary.id}`)); } catch (problem) { setError((problem as Error).message); }
  }

  const running = !!status?.running;
  const match = opened ?? status?.match ?? null;
  const ready = seats.every(seat => seat.key);
  const hasAi = seats.some(seat => aiModel(seat.key));
  // Three screens: setting a match up, watching one, and its result.
  const stage = running && !opened ? 'live' : !match || setupOpen ? 'setup' : match.current ? 'live' : 'result';
  const views = [describeSeat(seats[0], roster, t), describeSeat(seats[1], roster, t)] as const;
  const seatCard = (index: 0 | 1) => (
    <SeatCard key={index} label={t(`setup.player${index + 1}`)} seat={seats[index]} view={views[index]} disabled={running} roster={roster}
      onChange={seat => setSeats(index ? [seats[0], seat] : [seat, seats[1]])} />
  );

  return (
    <section id="arena" aria-label={t('label')} data-stage={stage}>
      <header className="arena-header">
        <h1>{t('title')}</h1>
        <Link className="button" to="/settings/engines">{t('enginesLink')}</Link>
      </header>
      {error && <p className="arena-error" role="alert">{error}</p>}
      {stage === 'setup' && (
        <section className="arena-setup" aria-label={t('setup.label')}>
          <div className="arena-faceoff">
            {seatCard(0)}
            <Prediction a={views[0]} b={views[1]} games={settings.games} />
            {seatCard(1)}
          </div>
          <div className="arena-options">
            <div className="arena-settings">
              <Choice label={t('setup.games')} options={GAME_COUNTS.map(n => [n, String(n)])} value={settings.games} disabled={running}
                onChange={games => setSettings({ ...settings, games })} />
              <Choice label={t('setup.movetime')} options={MOVETIMES.map(s => [s, t('setup.seconds', { seconds: s })])} value={settings.movetime} disabled={running}
                onChange={movetime => setSettings({ ...settings, movetime })} />
              <Choice label={t('setup.openings')} options={[['start', t('setup.openingsStart')], ['varied', t('setup.openingsVaried')], ['book', t('setup.openingsBook')]]} value={settings.openings} disabled={running}
                onChange={openings => setSettings({ ...settings, openings })} />
              <Choice label={t('setup.pace')} options={[['watch', t('setup.paceWatch')], ['fast', t('setup.paceFast')]]} value={settings.pace} disabled={running}
                onChange={pace => setSettings({ ...settings, pace })} />
              <Choice label={t('setup.sprt')} options={[['off', t('setup.sprtOff')], ['on', t('setup.sprtOn')]]} value={settings.sprt ? 'on' : 'off'} disabled={running}
                onChange={sprt => setSettings({ ...settings, sprt: sprt === 'on' })} />
              {hasAi && (
                <Choice label={t('setup.costCap')} options={COST_CAPS.map(cap => [cap, cap ? `$${cap}` : t('setup.costCapNone')])} value={settings.costCap ?? 0} disabled={running}
                  onChange={costCap => setSettings({ ...settings, costCap })} />
              )}
            </div>
            <div className="arena-go">
              <p className="arena-hint">{t({ start: 'setup.startHint', varied: 'setup.variedHint', book: 'setup.bookHint' }[settings.openings])}{settings.sprt ? ` ${t('setup.sprtHint')}` : ''}{hasAi ? ` ${t('setup.aiHint')}` : ''}</p>
              {match && <button type="button" className="button" onClick={() => setSetupOpen(false)}>{t('result.back')}</button>}
              <button type="button" className="button primary arena-start" disabled={!ready || starting} onClick={() => void start()}>{starting ? t('starting') : t('start')}</button>
            </div>
          </div>
          <MoreLegends missing={missing} onAdded={replaceMasters} />
        </section>
      )}
      {stage === 'live' && match && (
        <MatchView match={match} running={running && !opened} onStop={() => void stop()} onClose={opened ? () => setOpened(null) : undefined} />
      )}
      {stage === 'result' && match && (
        <ResultView match={match} canRematch={ready && !starting} onRematch={() => void start()}
          onNew={() => { setOpened(null); setSetupOpen(true); }} />
      )}
      {stage !== 'live' && (
        <div className="arena-columns">
          {!!status?.recent.length && (
            <section className="arena-recent" aria-labelledby="arena-recent-title">
              <h2 id="arena-recent-title">{t('recent.title')}</h2>
              <ul className="arena-list">
                {status.recent.map(row => {
                  const [a, b] = row.players;
                  return (
                    <li key={row.id}>
                      <button type="button" onClick={() => void open(row)} aria-pressed={opened?.id === row.id}>
                        <img className="arena-tile" src={playerFigure(a)} alt="" />
                        <span className="arena-recent-main">
                          <span className="arena-recent-names">
                            <span className={row.score[0] > row.score[1] ? 'won' : undefined}>{a.name}</span>
                            <b>{half(row.score[0])}–{half(row.score[1])}</b>
                            <span className={row.score[1] > row.score[0] ? 'won' : undefined}>{b.name}</span>
                          </span>
                          <small>{row.date} · {t('recent.games', { count: row.games_played })}{row.elo_diff !== null ? ` · ${t('eloGap', { name: row.players[row.elo_diff >= 0 ? 0 : 1].name, elo: Math.abs(row.elo_diff) })}` : ''}{row.capped ? ` · ${t('recent.capped')}` : row.stopped ? ` · ${t('recent.stopped')}` : ''}{row.cost && row.cost[0] + row.cost[1] > 0 ? ` · ${dollars(row.cost[0] + row.cost[1])}` : ''}{row.early && row.sprt?.verdict ? ` · ${t('recent.sprt')}` : ''}</small>
                        </span>
                        <img className="arena-tile" src={playerFigure(b)} alt="" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <ArenaLadder refresh={status?.recent[0]?.id} />
        </div>
      )}
    </section>
  );
}

function Choice<T extends string | number>({ label, options, value, disabled, onChange }: {
  label: string; options: [T, string][]; value: T; disabled: boolean; onChange: (value: T) => void;
}) {
  return (
    <div className="arena-choice" role="group" aria-label={label}>
      <span>{label}</span>
      <Segments>
        {options.map(([option, text]) => (
          <button key={String(option)} type="button" aria-pressed={option === value} className={option === value ? 'selected' : ''}
            disabled={disabled} onClick={() => onChange(option)}>{text}</button>
        ))}
      </Segments>
    </div>
  );
}

type Model = NonNullable<EngineInfo['models']>[number];
/** Everyone who can take a seat: installed engines, their installed models, and the legends on disk. */
interface Roster { engines: EngineInfo[]; models: { engine: EngineInfo; model: Model }[]; masters: MasterInfo[] }
/** What a seat card shows: who sits there, what kind of player they are, and the rating the prediction uses. */
interface SeatView { name: string; kind: 'legend' | 'engine' | 'model' | 'ai' | null; figure?: string; initials: string; rating: number | null; ratingText: string; blurb: string }

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map(word => word[0]).slice(0, 2).join('').toUpperCase();

function describeSeat(seat: Seat, roster: Roster, t: (key: string, options?: Record<string, unknown>) => string): SeatView {
  const model = aiModel(seat.key);
  if (model) {
    const name = model.slice(model.indexOf('/') + 1);
    return { name, kind: 'ai', figure: aiFigure(model), initials: initialsOf(name), rating: null, ratingText: model.split('/')[0],
      blurb: t('setup.aiNote', { level: t(`setup.aiLevels.${seat.level ?? 0}`) }) };
  }
  const [kind, id, modelId] = seat.key.split(':');
  if (kind === 'master') {
    const master = roster.masters.find(m => m.id === id);
    if (master) return {
      name: master.name, kind: 'legend', figure: legendFigure(master.id), initials: initialsOf(master.name), rating: master.elo, ratingText: String(master.elo),
      blurb: t(master.rated ? 'setup.legendNote' : 'setup.legendNoteUnrated', { count: master.games, games: master.games.toLocaleString(), elo: master.elo }),
    };
  }
  if (kind === 'model') {
    const found = roster.models.find(({ engine, model }) => engine.id === id && model.id === modelId);
    if (found) {
      const target = found.model.rating_target ?? null;
      return {
        name: found.model.name, kind: 'model', figure: engineFigure(id, modelId), initials: initialsOf(found.model.name), rating: target,
        ratingText: target ? `~${target}` : '', blurb: target ? t('setup.modelNote', { elo: target }) : found.engine.description,
      };
    }
  }
  if (kind === 'engine') {
    const engine = roster.engines.find(e => e.id === id);
    if (engine) {
      const nodesElo = seat.nodes && engine.type !== 'neural' ? eloForNodes(seat.nodes) : null;
      const rating = seat.nodes ? nodesElo : seat.elo || engine.strength_ccrl;
      const ratingText = seat.nodes ? (nodesElo ? `~${nodesElo}` : t('setup.nodes', { nodes: seat.nodes.toLocaleString() }))
        : seat.elo ? t('setup.rating', { elo: seat.elo }) : engine.strength_ccrl ? t('setup.ccrl', { elo: engine.strength_ccrl }) : '';
      return { name: engine.name, kind: 'engine', figure: engineFigure(engine.id), initials: initialsOf(engine.name), rating, ratingText, blurb: engine.description };
    }
  }
  return { name: t('setup.choose'), kind: null, initials: '', rating: null, ratingText: '', blurb: '' };
}

/** A seat: the player's figure, who they are, how strong, and the button that swaps them. */
function SeatCard({ label, seat, view, disabled, roster, onChange }: {
  label: string; seat: Seat; view: SeatView; disabled: boolean; roster: Roster; onChange: (seat: Seat) => void;
}) {
  const { t } = useTranslation('arena');
  const [picking, setPicking] = useState(false);
  const engine = seat.key.startsWith('engine:') ? roster.engines.find(e => e.id === seat.key.split(':')[1]) : undefined;
  return (
    <section className="arena-seat" aria-label={label}>
      <span className="arena-seat-slot">{label}</span>
      <div className="arena-seat-figure">
        {view.figure ? <img key={view.figure} src={view.figure} alt="" /> : view.initials ? <span className="arena-initials">{view.initials}</span> : null}
      </div>
      <div className="arena-seat-who">
        <strong>{view.name}</strong>
        {view.kind && (
          <span className="arena-seat-tags">
            <span className={`arena-kind ${view.kind}`}>{t(`kinds.${view.kind}`)}</span>
            {view.ratingText && <span className="arena-seat-rating">{view.ratingText}</span>}
          </span>
        )}
        {view.blurb && <p className="arena-seat-note">{view.blurb}</p>}
      </div>
      {engine && (
        <label className="arena-strength">{t('setup.strength')}
          {/* A rating (UCI_Elo / Skill Level) or a node budget per move ("n800"): any engine can be node-limited. */}
          <select value={seat.nodes ? `n${seat.nodes}` : seat.elo} disabled={disabled} onChange={e => {
            const value = e.target.value;
            onChange(value.startsWith('n') ? { ...seat, elo: 0, nodes: Number(value.slice(1)) } : { ...seat, elo: Number(value), nodes: undefined });
          }}>
            {ratable(engine) ? <optgroup label={t('setup.ratings')}>
              {RATINGS.map(r => <option key={r} value={r}>{r ? t('setup.rating', { elo: r }) : t('setup.fullStrength')}</option>)}
            </optgroup> : <option value={0}>{t('setup.fullStrength')}</option>}
            <optgroup label={t('setup.nodeLimit')}>
              {NODE_LEVELS.map(n => <option key={n} value={`n${n}`}>
                {engine.type === 'neural' ? t('setup.nodes', { nodes: n.toLocaleString() }) : t('setup.nodesRated', { nodes: n.toLocaleString(), elo: eloForNodes(n) })}
              </option>)}
            </optgroup>
          </select>
        </label>
      )}
      {aiModel(seat.key) && (
        <>
          <label className="arena-strength">{t('setup.aiLevel')}
            <select value={seat.level ?? 0} disabled={disabled} onChange={e => onChange({ ...seat, level: Number(e.target.value) })}>
              {AI_LEVELS.map(level => <option key={level} value={level}>{t(`setup.aiLevels.${level}`)}</option>)}
            </select>
          </label>
          <label className="arena-strength">{t('setup.aiEffort')}
            <select value={seat.effort ?? ''} disabled={disabled} onChange={e => onChange({ ...seat, effort: (e.target.value || undefined) as ArenaAiEffort | undefined })}>
              <option value="">{t('setup.aiEffortDefault')}</option>
              {AI_EFFORTS.map(effort => <option key={effort} value={effort}>{t(`setup.aiEfforts.${effort}`)}</option>)}
            </select>
          </label>
        </>
      )}
      <button type="button" className="button arena-change" disabled={disabled} aria-expanded={picking} onClick={() => setPicking(!picking)}>
        {t('setup.change')}
      </button>
      {picking && !disabled && (
        <PlayerPicker label={label} current={seat.key} roster={roster} onClose={() => setPicking(false)}
          onPick={key => {
            const picked = roster.engines.find(x => `engine:${x.id}` === key);
            onChange(aiModel(key) ? { key, elo: 0, level: seat.level ?? 0, effort: seat.effort ?? 'high' }
              : { key, elo: ratable(picked) ? seat.elo : 0, nodes: picked ? seat.nodes : undefined });
            setPicking(false);
          }} />
      )}
    </section>
  );
}

/** Everyone who can sit down, as tiles: legends by era, engines, then human-like models. */
function PlayerPicker({ label, current, roster, onPick, onClose }: {
  label: string; current: string; roster: Roster; onPick: (key: string) => void; onClose: () => void;
}) {
  const { t } = useTranslation('arena');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const eras = ERAS.map(era => [era, roster.masters.filter(m => legendEra(m.id) === era).sort((a, b) => byHistory(a.id, b.id))] as const)
    .filter(([, list]) => list.length);
  const tile = (key: string, name: string, figure: string | undefined, rating: string) => (
    <button key={key} type="button" className="arena-pick" aria-pressed={current === key} onClick={() => onPick(key)}>
      {figure ? <img className="arena-tile" src={figure} alt="" loading="lazy" /> : <span className="arena-tile arena-initials">{initialsOf(name)}</span>}
      <span><strong>{name}</strong>{rating && <small>{rating}</small>}</span>
    </button>
  );
  return (
    <>
      <div className="arena-picker-scrim" onClick={onClose} />
      <div className="arena-picker" role="group" aria-label={t('setup.pickerLabel', { seat: label })}>
        {eras.map(([era, list]) => (
          <section key={era}>
            <h3>{t('setup.legendEra', { era: t(`setup.eras.${era}`) })}</h3>
            <div>{list.map(m => tile(`master:${m.id}`, m.name, legendFigure(m.id), m.peak ? String(m.peak) : ''))}</div>
          </section>
        ))}
        {roster.engines.length > 0 && (
          <section>
            <h3>{t('setup.engines')}</h3>
            <div>{roster.engines.map(e => tile(`engine:${e.id}`, e.name, engineFigure(e.id), ratable(e) ? t('setup.anyStrength') : e.strength_ccrl ? String(e.strength_ccrl) : ''))}</div>
          </section>
        )}
        {roster.models.length > 0 && (
          <section>
            <h3>{t('setup.humanLike')}</h3>
            <div>{roster.models.map(({ engine, model }) => tile(`model:${engine.id}:${model.id}`, model.name, engineFigure(engine.id, model.id), model.rating_target ? `~${model.rating_target}` : ''))}</div>
          </section>
        )}
        <section>
          <h3>{t('setup.aiModels')}</h3>
          <div>{AI_FEATURED.map(model => tile(`ai:${model}`, model.slice(model.indexOf('/') + 1), aiFigure(model), model.split('/')[0]))}</div>
          <form className="arena-ai-model" onSubmit={e => {
            e.preventDefault();
            const model = String(new FormData(e.currentTarget).get('model') ?? '').trim();
            if (model.includes('/')) onPick(`ai:${model}`);
          }}>
            <input name="model" aria-label={t('setup.aiModelLabel')} placeholder={t('setup.aiModelPlaceholder')} defaultValue={aiModel(current) ?? ''} />
            <button type="submit" className="button">{t('setup.aiSeat')}</button>
          </form>
        </section>
      </div>
    </>
  );
}

/** Between the seats: the score the two ratings predict, before a move is played. */
function Prediction({ a, b, games }: { a: SeatView; b: SeatView; games: number }) {
  const { t } = useTranslation('arena');
  const known = a.rating !== null && b.rating !== null;
  const share = known ? 1 / (1 + 10 ** ((b.rating! - a.rating!) / 400)) : 0.5;
  const gap = known ? Math.abs(a.rating! - b.rating!) : 0;
  return (
    <div className="arena-vs">
      <span className="arena-vs-badge" aria-hidden="true">{t('vs')}</span>
      {known ? (
        <>
          <span className="arena-vs-label">{t('predict.title')}</span>
          <span className="arena-vs-score" aria-label={t('predict.label', { first: a.name, second: b.name, a: (share * games).toFixed(1), b: ((1 - share) * games).toFixed(1) })}>
            {(share * games).toFixed(1)} – {((1 - share) * games).toFixed(1)}
          </span>
          <i className="arena-vs-bar" aria-hidden="true"><b style={{ width: `${Math.round(share * 100)}%` }} /></i>
          <span className="arena-vs-gap">{gap < 20 ? t('predict.even') : t('predict.gap', { name: share >= 0.5 ? a.name : b.name, points: gap })}</span>
        </>
      ) : <span className="arena-vs-gap">{t('predict.unknown')}</span>}
    </div>
  );
}

/** The champions download_masters.py knows that are not on disk yet: one click fetches their games. */
function MoreLegends({ missing, onAdded }: { missing: { id: string; name: string }[]; onAdded: (data: { masters: MasterInfo[]; missing: { id: string; name: string }[] }) => void }) {
  const { t } = useTranslation('arena');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!missing.length) return null;
  async function add(id: string) {
    setBusy(id);
    setProblem(null);
    try { onAdded(await api('api/masters/download', { id })); } catch (error) { setProblem((error as Error).message); } finally { setBusy(null); }
  }
  return (
    <details className="arena-more-legends">
      <summary>{t('legends.more', { count: missing.length })}</summary>
      <p>{t('legends.source')}</p>
      <div className="arena-legend-chips">
        {missing.map(m => (
          <button key={m.id} type="button" className="button" disabled={!!busy} onClick={() => void add(m.id)}>
            {busy === m.id ? t('legends.downloading') : m.name}
          </button>
        ))}
      </div>
      {problem && <p className="arena-error" role="alert">{problem}</p>}
    </details>
  );
}

/** A seat's figure: a legend's own, an engine's, or a robot. */
function playerFigure(player: ArenaPlayer): string {
  if (player.ai) return aiFigure(player.ai.model);
  return (player.masterId && legendFigure(player.masterId)) || engineFigure(player.engineId ?? '', player.modelId);
}

/** A seat's figure on the result screen: a legend celebrates a win or takes a loss in character. */
function resultFigure(player: ArenaPlayer, won: boolean | null): string {
  const pose = player.masterId && won !== null ? legendPose(player.masterId, won ? 'won' : 'lost') : undefined;
  return pose ?? playerFigure(player);
}

/** The match status line: the game in play, or how the match ended, then the Elo gap and the SPRT. */
function progressText(match: ArenaMatch, running: boolean, t: (key: string, options?: Record<string, unknown>) => string): string {
  const current = match.current, played = match.games.length, [a] = match.players;
  const main = match.phase === 'preparing' ? t('score.preparing')
    : running && current ? t('score.game', { number: current.number, total: match.settings.games }) + (current.opening ? ` · ${openingLabel(current, t)}` : '')
    : match.error ? t('score.failed', { error: match.error })
    : t(match.capped ? 'score.capped' : match.stopped ? 'score.stopped' : 'score.finished', { count: played });
  const gap = played > 0 && match.elo_diff !== undefined && match.elo_diff !== null && !running
    ? ` · ${t('eloGap', { name: match.players[match.elo_diff >= 0 ? 0 : 1].name, elo: Math.abs(match.elo_diff) })}` : '';
  const sprt = match.sprt ? ` · ${t(match.sprt.verdict ? `sprt.${match.sprt.verdict}` : 'sprt.open', { name: a.name, llr: match.sprt.llr.toFixed(2), lower: match.sprt.lower.toFixed(2), upper: match.sprt.upper.toFixed(2), elo1: match.sprt.elo1 })}` : '';
  return main + gap + sprt;
}

/** The two players and the score, read left to right as Player 1 to Player 2. */
function Scoreboard({ match }: { match: ArenaMatch }) {
  const { t } = useTranslation('arena');
  const [a, b] = match.players;
  return (
    <div className="arena-score" aria-label={t('score.label')}>
      <span className="arena-score-name">{a.name}</span>
      <b>{half(match.score[0])}</b><span className="arena-score-dash">–</span><b>{half(match.score[1])}</b>
      <span className="arena-score-name right">{b.name}</span>
    </div>
  );
}

const TALLY = GRADES;

/** Each player's graded moves side by side, with the grade icons; `extra` adds the game in play. */
function Tally({ match, extra, rows }: { match: ArenaMatch; extra?: [ArenaTally, ArenaTally]; rows?: ReactNode }) {
  const { t } = useTranslation('arena');
  const totals = match.grades ?? extra;
  if (!totals && !rows) return null;
  const sum = (player: 0 | 1, key: keyof ArenaTally) => {
    if ((match.grades && match.grades[player][key] == null) || (!match.grades && match.games.length)) return null;
    return (match.grades?.[player][key] ?? 0) + (extra?.[player][key] ?? 0);
  };
  return (
    <table className="arena-tally" aria-label={t('tally.label')}>
      <thead><tr><th /><th>{match.players[0].name}</th><th>{match.players[1].name}</th></tr></thead>
      <tbody>
        {rows}
        {totals && TALLY.map(key => (
          <tr key={key} className={`move-${key}`}>
            <th title={t(`board:grades.${key}.message`)}><img src={gradeIcon(key)} alt="" width="18" height="18" />{t(`tally.${key}`)}</th>
            {([0, 1] as const).map(player => <td key={player} className={sum(player, key) === 0 ? 'zero' : undefined}>{sum(player, key) ?? '–'}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The live game's graded moves so far, per player, to add to the finished games' tally. */
function liveTally(current: NonNullable<ArenaMatch['current']>): [ArenaTally, ArenaTally] {
  const tally = [emptyGrades(), emptyGrades()];
  current.notes.forEach((note, ply) => {
    const grade = note.grade;
    if (!grade) return;
    const name = gradeOf({ ...grade, accuracy: grade.accuracy ?? 0, ply, san: '' });
    const mover = ply % 2 === 0 ? current.white : (1 - current.white) as 0 | 1;
    if (name) tally[mover][name]++;
  });
  return [tally[0], tally[1]];
}

/** The games played so far, each with a replay link. */
function GamesTable({ match }: { match: ArenaMatch }) {
  const { t } = useTranslation('arena');
  if (!match.games.length) return null;
  return (
    <table className="arena-games">
      <thead><tr><th>#</th><th>{t('games.white')}</th><th>{t('games.black')}</th><th>{t('games.result')}</th><th>{t('games.moves')}</th><th>{t('games.ending')}</th><th /></tr></thead>
      <tbody>
        {match.games.map(game => (
          <tr key={game.number}>
            <td>{game.number}</td>
            <td>{match.players[game.white].name}{game.book[game.white] ? <small> · {t('games.book', { count: game.book[game.white] })}</small> : null}</td>
            <td>{match.players[1 - game.white].name}{game.book[1 - game.white] ? <small> · {t('games.book', { count: game.book[1 - game.white] })}</small> : null}</td>
            <td><b>{game.result.replace('1/2', '½').replace('1/2', '½')}</b> <small>({pointsFor(game, 0)}–{pointsFor(game, 1)})</small></td>
            <td>{Math.ceil(game.plies / 2)}</td>
            <td>{t(`endings.${game.termination.replace(/ /g, '_')}`, { defaultValue: game.termination })}{game.opening ? <small> · {openingLabel(game, t)}</small> : null}</td>
            <td>{game.moves?.length ? <Link to={explorePath({ fen: START_FEN, moves: game.moves, base: 0, from: '/arena' })}>{t('games.replay')}</Link> : null}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The live game, laid out like a game review: the board and its players on the left, the match on the right. */
function MatchView({ match, running, onStop, onClose }: { match: ArenaMatch; running: boolean; onStop: () => void; onClose?: () => void }) {
  const { t } = useTranslation('arena');
  const current = match.current;
  const planning = usePlanning(current?.board ?? null);
  const [a, b] = match.players;
  const lastNote = current?.notes.at(-1);
  const lastBook = lastNote?.book ? lastNote : null;
  const spent = match.cost && match.cost[0] + match.cost[1] > 0 ? match.cost : null;
  const lastMover = current ? (current.moves.length % 2 === 1 ? current.white : (1 - current.white) as 0 | 1) : null;
  // The judge's grades as the move list's judgments, so the list marks best moves, brilliancies and slips.
  const judgments = useMemo(() => new Map<number, AnalyzedMove>((current?.notes ?? []).flatMap((note, ply) => note.grade
    ? [[ply + 1, { ...note.grade, ply: ply + 1, san: current!.moves[ply].san, accuracy: note.grade.accuracy ?? 0 }] as const]
    : [])), [current]);
  const seat = (player: 0 | 1): ReactNode => {
    const info = match.players[player];
    const color = current ? (current.white === player ? 'white' : 'black') : null;
    const evaluation = evalText(current?.evals[player]);
    return (
      <div className={`arena-player${current && current.board.turn === color && running ? ' to-move' : ''}`}>
        <img className="arena-player-figure" src={playerFigure(info)} alt="" />
        <div><strong>{info.name}</strong>
          <small>{info.masterId ? t('player.legend', { engine: info.engine, elo: info.elo }) : info.rating ? `${info.engine} · ${info.rating}` : info.engine}
            {info.ai && current?.board.turn === color && running ? ` · ${t('ai.thinking')}` : ''}</small></div>
        {evaluation && <span className="arena-eval" title={t('player.evalTitle')}>{evaluation}</span>}
        {color && <span className={`arena-color ${color}`}>{t(`games.${color}`)}</span>}
      </div>
    );
  };
  const top = current ? ((1 - current.white) as 0 | 1) : 1;
  const line = current ? judgeLine(current.judge) : null;
  const chance = current ? whiteChance(current.board, line) : null;
  // The strip reads left to right as Player 1 to Player 2, whatever their colors.
  const firstChance = chance === null || !current ? null : current.white === 0 ? chance : 100 - chance;
  return (
    <div className="arena-live">
      <div className="arena-board-column">
        {seat(top)}
        {current && (
          <div className="arena-board">
            <ChessBoard board={current.board} flipped={false} planning={planning} lastMove={current.lastMove} movable={false}
              evalBar={<EvalBar board={current.board} line={line} flipped={false} />} />
          </div>
        )}
        {seat((1 - top) as 0 | 1)}
      </div>
      <aside className="arena-panel">
        <Scoreboard match={match} />
        <p className="arena-progress" role="status">{progressText(match, running, t)}</p>
        {spent && <p className="arena-cost">{t('ai.spent', { first: a.name, a: dollars(spent[0]), second: b.name, b: dollars(spent[1]) })}</p>}
        {current && (
          <div className="arena-chance" role="img" aria-label={firstChance === null ? t('chance.pending')
            : t('chance.label', { first: a.name, firstChance, second: b.name, secondChance: 100 - firstChance })}>
            <span>{firstChance !== null ? `${firstChance}%` : ''}</span>
            <i className={firstChance === null ? 'pending' : ''}><b style={{ width: `${firstChance ?? 50}%` }} /></i>
            <span>{firstChance !== null ? `${100 - firstChance}%` : ''}</span>
          </div>
        )}
        {current && (
          <>
            <p className="arena-book-line" aria-live="polite">
              {lastBook?.book && lastMover !== null
                ? t('book.line', { name: match.players[lastMover].name, count: lastBook.book.count, total: lastBook.book.total, opponent: lastBook.book.game.opponent, year: lastBook.book.game.year ?? '?' })
                : lastNote?.opening ? t('book.opening') : ' '}
            </p>
            {lastNote?.ai && lastMover !== null && (
              <p className="arena-ai-line" aria-live="polite">
                <strong>{match.players[lastMover].name}</strong> “{lastNote.ai.reason || t('ai.noReason')}”
                <small> {t('ai.turn', { seconds: lastNote.ai.seconds, cost: dollars(lastNote.ai.cost) })}
                  {lastNote.ai.rescued ? ` · ${t('ai.rescued')}` : lastNote.ai.tries > 1 ? ` · ${t('ai.retried', { count: lastNote.ai.tries - 1 })}` : ''}</small>
              </p>
            )}
            <div className="moves-heading"><span>{t('moves')}</span></div>
            <MoveList initialFen={START_FEN} moves={current.moves} cursor={current.moves.length} onSelect={() => {}} judgments={judgments} />
            <Tally match={match} extra={liveTally(current)} />
          </>
        )}
        <GamesTable match={match} />
        <div className="arena-panel-actions">
          {onClose && <button type="button" className="button" onClick={onClose}>{t('close')}</button>}
          {running && <button type="button" className="button danger" onClick={onStop}>{t('stop')}</button>}
        </div>
      </aside>
    </div>
  );
}

/** A finished match: the winner up front with the score, then how each side played, then the games. */
function ResultView({ match, canRematch, onRematch, onNew }: { match: ArenaMatch; canRematch: boolean; onRematch: () => void; onNew: () => void }) {
  const { t } = useTranslation('arena');
  const winner = match.score[0] === match.score[1] ? null : match.score[0] > match.score[1] ? 0 : 1;
  const count = (player: 0 | 1, points: string) => match.games.filter(game => pointsFor(game, player) === points).length;
  return (
    <div className="arena-result">
      <div className="arena-result-stage">
        {([0, 1] as const).map(player => (
          <figure key={player} className={`arena-result-player${winner === player ? ' winner' : winner === null ? '' : ' loser'}`}>
            {winner === player && <img className="arena-result-wreath" src={hallArt('wreath')} alt="" />}
            <img className="arena-result-figure" src={resultFigure(match.players[player], winner === null ? null : winner === player)} alt="" />
          </figure>
        ))}
        <div className="arena-result-headline">
          <h2>{winner === null ? t('result.draw') : t('result.wins', { name: match.players[winner].name })}</h2>
          <Scoreboard match={match} />
          <p className="arena-progress" role="status">{progressText(match, false, t)}</p>
        </div>
      </div>
      <div className="arena-result-body">
        <Tally match={match} rows={<>
          <tr><th>{t('tally.wins')}</th><td>{count(0, '1')}</td><td>{count(1, '1')}</td></tr>
          <tr><th>{t('tally.draws')}</th><td>{count(0, '½')}</td><td>{count(1, '½')}</td></tr>
        </>} />
        <GamesTable match={match} />
        <div className="arena-panel-actions">
          <button type="button" className="button" onClick={onNew}>{t('result.newMatch')}</button>
          <button type="button" className="button primary" disabled={!canRematch} onClick={onRematch}>{t('result.rematch')}</button>
        </div>
      </div>
    </div>
  );
}
