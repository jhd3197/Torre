// /play — your game against a bot. It is saved in this browser after every move.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BoardWorkspace } from '../components/BoardWorkspace';
import { Dialog } from '../components/Dialog';
import { brandIcon, Mascot, Stars } from '../components/Reward';
import { botById, inCostume, legendBots, mergeEngineBots, type Bot } from '../data/bots';
import { useMasters } from '../hooks/useMasters';
import { figureSrc } from '../lib/pieces';
import { botMove, coachCheck, playMove, type MoveJudgement } from '../hooks/useChess';
import { sideToMove, START_FEN } from '../lib/format';
import { api } from '../lib/api';
import { badgeImage, TIER_NAMES, type AwardGain } from '../lib/awards';
import { explorePath } from '../lib/routes';
import { outcomeFor, recordStars, starCount, starGoals } from '../lib/stars';
import { keepEventBot } from '../lib/events';
import { eventTitle, liveEvent } from '../data/collections';
import { clearPlay, LEVELS, loadPlay, PHASES, savePlay, type PlaySave } from '../lib/storage';
import { useEngines, useGameData, useToast } from '../state/AppData';
import type { BoardState, BookHit, Color } from '../types';
import { CoachRook } from '../components/CoachRook';
import { PlayCoach, type CoachMarks } from '../components/PlayCoach';
import { BotReport, DrawRule } from '../components/BotReport';
import { whyItFails } from '../lib/whyItFails';
import { useMoveTiming } from '../hooks/useMoveTiming';
import { useNarration } from '../hooks/useNarration';
import { playBlindfold, quietCoach } from '../lib/settings';
import { useBotMechanics } from '../hooks/useBotMechanics';
import { exportPlay } from '../lib/gameExport';
import { playPgn } from '../lib/playPgn';
import { PhoneAction } from '../components/workspace/PhoneParts';

/** How many of the moves were yours. */
function yourMoveCount(game: PlaySave): number {
  const youFirst = sideToMove(game.initialFen) === game.playerColor;
  return youFirst ? Math.ceil(game.moves.length / 2) : Math.floor(game.moves.length / 2);
}

const NO_MOVES: PlaySave['moves'] = [];

/** Centipawns a move must throw away for the coach to stop it (a mistake, by the coach's reckoning). */
const COACH_STEP_IN = 150;

export function PlayPage() {
  const { t } = useTranslation('play');
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { engineAvailable, insights } = useGameData();
  const { engines } = useEngines();
  const engineBots = useMemo(() => mergeEngineBots(engines), [engines]);
  const { masters } = useMasters();
  const legends = useMemo(() => legendBots(masters, t), [masters, t]);
  const [game, setGame] = useState<PlaySave | null>(() => loadPlay());
  const [cursor, setCursor] = useState(() => game?.moves.length ?? 0);
  const [busy, setBusy] = useState(false);
  const [engineError, setEngineError] = useState(false);
  const [live, setLive] = useState<BoardState | null>(null);
  const [flipped, setFlipped] = useState(game?.playerColor === 'black');
  const [confirmResign, setConfirmResign] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [improved, setImproved] = useState(false);
  const [kept, setKept] = useState<{ event: string; count: number; need: number; crest: boolean } | null>(null);
  const [gains, setGains] = useState<AwardGain[]>([]);
  const [exporting, setExporting] = useState(false);
  /** What the coach points at on the board while you play with it. */
  const [coachMarks, setCoachMarks] = useState<CoachMarks>({});
  /** A move the coach stopped before it was played: it would be a mistake. */
  const [held, setHeld] = useState<{ uci: string; judged: MoveJudgement & { best: { uci: string; san: string } | null } } | null>(null);
  const { t: tl } = useTranslation('lessons');
  // Rooky's voice: the word before a mistake is said aloud, unless the coach is set to stay quiet.
  const voice = useNarration();
  const quiet = quietCoach.use();
  /** Where a legend's last move came from: one of their games, or null once they are out of book. */
  const [bookNote, setBookNote] = useState<BookHit | null | undefined>(undefined);

  // A new game started from the bot lobby arrives with a new location key.
  // `live` is not reset here: the board reports the new position itself, and a
  // reset would race with that report (child effects run first).
  useEffect(() => {
    const saved = loadPlay();
    setGame(saved);
    setCursor(saved?.moves.length ?? 0);
    setFlipped(saved?.playerColor === 'black');
    setConfirmResign(false);
    setResultOpen(false);
    setGains([]);
    setBookNote(undefined);
    setHeld(null);
  }, [location.key]);

  const update = useCallback((next: PlaySave) => { setGame(next); savePlay(next); }, []);

  const found: Bot | undefined = game?.botId
    ? botById(game.botId) ?? engineBots.find(candidate => candidate.id === game.botId) ?? legends.find(candidate => candidate.id === game.botId)
    : undefined;
  // A bot kept from an event plays in its costume, after the event too.
  // In a character's costume (El Silbón) it is that character: its name, opening line and mechanics.
  const bot = found && game?.costume ? inCostume(found, game.costume, game.outfit)
    : found && game?.outfit ? Object.assign(Object.create(found) as Bot, { avatar: game.outfit }) : found;
  const total = game?.moves.length ?? 0;
  const atLive = cursor === total;
  const turn: Color | null = game ? ((sideToMove(game.initialFen) === 'white') === (total % 2 === 0) ? 'white' : 'black') : null;
  const onBoard = useCallback((board: BoardState) => { if (atLive) setLive(board); }, [atLive]);
  const boardOver = !!(live && live.fen && atLive && live.result);
  const result = game?.resigned ? game.result : boardOver ? live!.result : null;
  const readTiming = useMoveTiming(location.key, total,
    !!game && !!live && !result && !busy && atLive && turn === game.playerColor
    && live.fen.split(' ')[1] === (turn === 'white' ? 'w' : 'b'));

  // The game just ended: save the result, award its stars once, and show them.
  useEffect(() => {
    if (!game || !result) return;
    if (game.result === result && game.rewarded) return;
    // A game played with the coach is practice: it counts for awards, but earns no stars.
    const stars = starCount(starGoals(result, game.playerColor, yourMoveCount(game)));
    setImproved(game.coached ? false : recordStars(game.starsKey ?? game.botId ?? `sf18-l${game.level}`, stars));
    // Beating an event bot while its event is on keeps it, in costume; enough of them earn the crest.
    const event = game.event ? liveEvent(game.event) : undefined;
    if (event && game.botId && !game.coached && outcomeFor(result, game.playerColor) === 'win') {
      const need = event.need!;
      const change = keepEventBot(event.id, game.botId, need);
      setKept(change.kept ? { event: event.id, count: change.count, need, crest: change.crest } : null);
    } else setKept(null);
    const gameId = game.gameId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    update({ ...game, result, rewarded: true, gameId });
    setResultOpen(true);
    // Count the game toward your awards; the dialog lists anything it unlocked.
    api<{ improved: AwardGain[] }>('api/played', {
      gameId, initialFen: game.initialFen, moves: game.moves.map(m => m.uci), playerColor: game.playerColor, result,
      resigned: !!game.resigned, botId: game.botId ?? 'sf18', ...(game.elo ? { elo: game.elo } : {}), ...(game.engineId ? { engineId: game.engineId } : {}),
      ...(game.modelId ? { modelId: game.modelId } : {}), ...(game.masterId ? { masterId: game.masterId } : {}),
      ...(game.coached ? { coached: true } : {}),
    }).then(data => setGains(data.improved ?? []), () => { /* awards are a bonus; the game is saved locally */ });
  }, [result, game, update]);

  // The bot replies whenever it is its turn on the live position. Leaving the
  // page cancels the reply, so it can never land on a game started meanwhile.
  const thinking = useRef(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!game || game.resigned || !atLive || !live || live.result || turn === game.playerColor || thinking.current || engineError) return;
    if (live.fen.split(' ')[1] !== (turn === 'white' ? 'w' : 'b')) return; // board not caught up yet
    thinking.current = true;
    setBusy(true);
    const controller = new AbortController();
    pending.current = controller;
    (async () => {
      try {
        const reply = await botMove(game.initialFen, game.moves, game.level, controller.signal, game.elo, game.engineId, game.modelId,
          game.masterId, game.nodes, game.phaseElo);
        const { best, book } = reply;
        if (!best) return;
        if (game.masterId) setBookNote(book ?? null);
        const played = await playMove(game.initialFen, game.moves, best, controller.signal);
        // The bot's own record of the move, for the after-game card: its phase, rating and any slip.
        const note = { ply: game.moves.length + 1, slip: !!reply.slip, ...(reply.phase ? { phase: reply.phase } : {}), ...(reply.elo ? { elo: reply.elo } : {}) };
        const next = { ...game, moves: [...game.moves, { uci: best, san: played.san }], result: played.result,
          botNotes: [...(game.botNotes ?? []), note] };
        update(next);
        setCursor(next.moves.length);
      } catch (error) {
        if (controller.signal.aborted) return;
        setEngineError(true);
        toast((error as Error).message);
      } finally {
        thinking.current = false;
        if (pending.current === controller) pending.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
  }, [game, atLive, live, turn, engineError, update, toast]);

  // A custom bot's mechanics (data/botMechanics.ts): its sounds, its lines, the board's mood.
  const mechanics = useBotMechanics({ botId: bot?.costumeId ?? game?.botId, gameKey: location.key, initialFen: game?.initialFen ?? START_FEN,
    moves: game?.moves ?? NO_MOVES, you: game?.playerColor ?? 'white', live: atLive ? live : null, result });

  if (!game) return <Navigate to="/play/bots" replace />;

  async function move(uci: string, checked = false) {
    if (!game || result) return;
    if (!atLive) { toast(t('game.earlierPosition')); return; }
    if (turn !== game.playerColor || busy) return;
    const timing = readTiming(uci);
    setBusy(true);
    setHeld(null);
    try {
      // With the coach, a move that throws away a lot is stopped before it is played, with the reason.
      if (game.coached && !checked) {
        const judged = await coachCheck(game.initialFen, game.moves, uci).catch(() => null);
        const mating = (judged?.motifs ?? []).some(m => m.startsWith('mateIn') || m === 'backRankMate');
        if (judged && judged.verdict === 'worse' && (judged.loss >= COACH_STEP_IN || mating)) {
          setHeld({ uci, judged });
          if (!quiet) voice.speak({ narration: `${t('coach.holdOn', { san: judged.line[0] ?? uci })} ${whyItFails(tl, judged, botName)}` });
          return;
        }
      }
      const played = await playMove(game.initialFen, game.moves, uci);
      const next = { ...game, moves: [...game.moves, { uci, san: played.san }], result: played.result,
        timings: [...(game.timings ?? []), ...(timing ? [timing] : [])] };
      update(next);
      setCursor(next.moves.length);
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** A practice game with the coach from a position of this one (the report's costliest mistake). */
  function retryFrom(fen: string) {
    if (!game) return;
    savePlay({ initialFen: fen, moves: [], playerColor: game.playerColor, level: game.level, result: null, coached: true,
      ...(game.botId ? { botId: game.botId } : {}), ...(game.elo ? { elo: game.elo } : {}),
      ...(game.engineId ? { engineId: game.engineId } : {}), ...(game.modelId ? { modelId: game.modelId } : {}),
      ...(game.nodes ? { nodes: game.nodes } : {}), ...(game.botName ? { botName: game.botName } : {}),
      ...(game.phaseElo ? { phaseElo: game.phaseElo } : {}) });
    navigate('/play', { state: { started: Date.now() } });
  }

  async function copyPgn() {
    if (!game) return;
    try {
      await navigator.clipboard.writeText(playPgn(game, you, botName));
      toast(t('game.pgnCopied'));
    } catch {
      toast(t('game.pgnCopyFailed'));
    }
  }

  /** With the coach: take back your last move and the bot's reply, and try that moment again. */
  function takeBack() {
    if (!game || busy) return;
    pending.current?.abort();
    const yourLast = game.moves.length - (turn === game.playerColor ? 2 : 1);
    if (yourLast < 0) return;
    const moves = game.moves.slice(0, yourLast);
    update({ ...game, moves, result: null, resigned: false, rewarded: false, takebacks: (game.takebacks ?? 0) + 1,
      botNotes: (game.botNotes ?? []).filter(n => n.ply <= moves.length) });
    setCursor(moves.length);
    setResultOpen(false);
  }

  function resign() {
    if (!game) return;
    pending.current?.abort();
    setConfirmResign(false);
    update({ ...game, resigned: true, result: game.playerColor === 'white' ? '0-1' : '1-0', rewarded: false });
  }

  function rematch() {
    if (!game) return;
    savePlay({ initialFen: game.initialFen, moves: [], playerColor: game.playerColor, level: game.level,
      result: null, ...(game.botId ? { botId: game.botId } : {}), ...(game.elo ? { elo: game.elo } : {}),
      ...(game.engineId ? { engineId: game.engineId } : {}), ...(game.modelId ? { modelId: game.modelId } : {}),
      ...(game.masterId ? { masterId: game.masterId } : {}), ...(game.botName ? { botName: game.botName } : {}),
      ...(game.phaseElo ? { phaseElo: game.phaseElo } : {}), ...(game.coached ? { coached: true } : {}),
      ...(game.outfit ? { outfit: game.outfit } : {}), ...(game.event ? { event: game.event } : {}), ...(game.starsKey ? { starsKey: game.starsKey } : {}), ...(game.costume ? { costume: game.costume } : {}) });
    navigate('/play', { state: { started: Date.now() } });
  }

  const you = insights?.user || 'Player';
  const botName = bot?.name ?? game.botName ?? 'Stockfish 18';
  const info = (color: Color) => color === game.playerColor
    ? { name: <>{you} <span className="you-badge">{t('game.youBadge')}</span></>, detail: color === 'white' ? t('game.youWhite') : t('game.youBlack') }
    : { name: botName, detail: `${game.phaseElo ? t('game.botPhases', { ratings: PHASES.map(p => game.phaseElo![p]).join(' / ') }) : game.elo ? t('game.botRated', { elo: game.elo }) : game.engineId ? (bot?.kind ?? 'engine') : t('game.botLevel', { level: game.level })} · ${color === 'white' ? t('game.whitePieces') : t('game.blackPieces')}`, avatar: bot?.avatar ?? bot?.portrait };
  const yourTurn = !result && atLive && turn === game.playerColor && !busy;
  // A blindfold game shows the pieces again once it is over.
  const blindfold = playBlindfold.use() && !result;

  // What the bot and the coach have to say: in the panel on a desk, under the board on a phone.
  const say = <>
    {mechanics.line && <p className="bot-speech" role="status">“{mechanics.line}”</p>}
    {game.masterId && bookNote !== undefined && !result && (
      <p className={`legend-book-note${bookNote ? '' : ' out'}`} role="status">{bookNote
        ? t('legend.fromGame', { name: botName, count: bookNote.count, total: bookNote.total, opponent: bookNote.game.opponent, year: bookNote.game.year ?? '?' })
        : t('legend.outOfBook', { name: botName, elo: game.elo })}</p>
    )}
    {!result && !held && !game.coached && <CoachRook initialFen={game.initialFen} moves={game.moves} you={game.playerColor} botName={botName} board={live}
      thinking={busy && turn !== game.playerColor} reviewing={!atLive} />}
    {held && (
      <div className="coach-hold" role="alert">
        <Mascot pose="alarm" size={56} />
        <div>
          <strong>{t('coach.holdOn', { san: held.judged.line[0] ?? held.uci })}</strong>
          <p>{whyItFails(tl, held.judged, botName)}</p>
          <div className="coach-hold-actions">
            <button type="button" className="button primary" onClick={() => setHeld(null)}>{t('coach.thinkAgain')}</button>
            <button type="button" className="button" onClick={() => { const uci = held.uci; setHeld(null); void move(uci, true); }}>{t('coach.playAnyway')}</button>
          </div>
        </div>
      </div>
    )}
    {game.coached && !held && !result && <PlayCoach initialFen={game.initialFen} moves={game.moves} yourTurn={yourTurn} botName={botName} onMarks={setCoachMarks} />}
  </>;
  const leave = () => { clearPlay(); navigate('/play/bots'); };
  const botColor: Color = game.playerColor === 'white' ? 'black' : 'white';
  const explorePosition = explorePath({ fen: game.initialFen, moves: game.moves.slice(0, cursor).map(m => m.uci), base: cursor, from: '/play', flipped });
  // The phone's four buttons: the game's way forward first, a new opponent last.
  const phoneActions = result ? <>
    <PhoneAction icon="trophy" label={t('game.seeResult')} tone="primary" onClick={() => setResultOpen(true)} />
    <PhoneAction icon="repeat" label={t('game.rematch')} onClick={rematch} />
    <PhoneAction icon="search" label={t('phone.review')} to={explorePath({ fen: game.initialFen, moves: game.moves.map(m => m.uci), base: game.moves.length, from: '/play', flipped })} />
    <PhoneAction icon="plus" label={t('phone.new')} onClick={() => navigate('/play/bots')} />
  </> : confirmResign ? <>
    <PhoneAction icon="back" label={t('game.keepPlaying')} onClick={() => setConfirmResign(false)} />
    <PhoneAction icon="flag" label={t('game.confirmResign')} tone="danger" onClick={resign} />
  </> : <>
    {game.coached
      ? <PhoneAction icon="undo" label={t('phone.takeBack')} disabled={busy || total < 1} onClick={takeBack} />
      : <PhoneAction icon="search" label={t('phone.explore')} to={explorePosition} />}
    {yourMoveCount(game) === 0
      ? <PhoneAction icon="exit" label={t('game.leave')} onClick={leave} />
      : <PhoneAction icon="flag" label={t('game.resign')} onClick={() => setConfirmResign(true)} />}
    <PhoneAction icon="plus" label={t('phone.new')} tone="primary" onClick={() => navigate('/play/bots')} />
  </>;

  return (
    <>
      <BoardWorkspace mode="play" initialFen={game.initialFen} moves={game.moves} cursor={cursor}
        onGo={ply => setCursor(Math.max(0, Math.min(total, ply)))} flipped={flipped} onFlip={() => setFlipped(!flipped)}
        players={{ white: info('white'), black: info('black') }} movable={result ? false : game.playerColor} onMove={move} busy={busy} hidePieces={blindfold}
        busyText={busy && game.coached && turn === game.playerColor ? t('coach.looking') : t('game.thinking', { name: botName })} onBoard={onBoard}
        coachMarks={held ? { annotations: [{ from: held.uci.slice(0, 2), to: held.uci.slice(2, 4) }] } : game.coached ? coachMarks : undefined} resultText={game.resigned ? t('game.resigned', { result: game.result }) : undefined}
        phoneHead={{ title: botName, sub: info(botColor).detail, back: '/play/bots' }}
        phoneSay={<div className="phone-say">{say}{(engineError || !engineAvailable) && (
          <p className="coach-note" role="alert">{engineAvailable ? t('game.botCouldNotReply', { name: botName }) : t('game.installStockfish')}
            <button type="button" className="text-button" onClick={() => setEngineError(false)}>{t('game.retry')}</button></p>
        )}</div>}
        phoneActions={phoneActions}
        headerActions={<>
          <Link className="text-button" id="explore-position" to={explorePosition}>{t('game.explorePosition')}</Link>
          <button type="button" className="text-button" disabled={exporting || busy} title={t('game.exportTorreTitle')}
            onClick={async () => {
              setExporting(true);
              try { await exportPlay(game, you, botName); }
              catch (error) { toast((error as Error).message); }
              finally { setExporting(false); }
            }}>{t('game.exportTorre')}</button>
          <button type="button" className="text-button" id="copy-pgn" disabled={!total} onClick={copyPgn}>{t('game.copyPgn')}</button>
        </>}
        boardFooter={!atLive ? <button id="live-return" type="button" className="button" onClick={() => setCursor(total)}>{t('game.returnToLive')}</button> : undefined}
        panelTop={<>
          {bot && <OpponentCard bot={bot} />}
          {say}
          <div className="play-actions">
            {game.coached && total >= 1 && !busy && (
              <button type="button" className="button" id="take-back" onClick={takeBack}>{t('coach.takeBack')}</button>
            )}
            {result ? <>
              <button type="button" className="button primary" onClick={() => setResultOpen(true)}>{t('game.seeResult')}</button>
              <button type="button" className="button" onClick={rematch}>{t('game.rematch')}</button>
            </> : confirmResign ? <>
              <Mascot pose="salute" size={40} className="resign-mascot" />
              <button type="button" className="button danger" id="confirm-resign" onClick={resign}>{t('game.confirmResign')}</button>
              <button type="button" className="button" onClick={() => setConfirmResign(false)}>{t('game.keepPlaying')}</button>
            </> : yourMoveCount(game) === 0 ? (
              // Before your first move there is nothing to resign: leave, and the game never counts.
              <button type="button" className="button" id="leave-game" title={t('game.leaveNote')}
                onClick={leave}>
                {t('game.leave')}
              </button>
            ) : (
              <button type="button" className="button" id="resign" onClick={() => setConfirmResign(true)}>
                <img src={brandIcon('resign')} alt="" width="14" height="14" /> {t('game.resign')}
              </button>
            )}
          </div>
          <details id="play-settings">
            <summary>{t('game.settings')} <span>{game.elo ? t('game.settingsOpponent') : t('game.settingsStrength')}</span></summary>
            <div className="settings-fields">
              {!game.elo && !game.engineId && (
                <label>{t('game.opponentStrength')}
                  <select id="level" value={game.level} onChange={e => update({ ...game, level: Number(e.target.value) })}>
                    {LEVELS.map(level => <option key={level} value={level}>{t(`game.levels.${level}`)}</option>)}
                  </select>
                </label>
              )}
              <button className="button primary" id="new-game" type="button" onClick={() => navigate('/play/bots')}>{t('game.newGame')}</button>
            </div>
          </details>
        </>}
        panelBottom={(engineError || !engineAvailable) ? (
          <div className="coach-note"><span>✧</span><div>
            <strong id="note-title">{t('game.engineUnavailable')}</strong>
            <p id="note-body">{engineAvailable ? t('game.botCouldNotReply', { name: botName }) : t('game.installStockfish')}
              <button type="button" className="text-button icon-text" onClick={() => setEngineError(false)}><img src="art/ui3d/retry.webp" alt="" width="18" height="18" />{t('game.retry')}</button></p>
          </div></div>
        ) : undefined} />
      {result && (
        <ResultDialog open={resultOpen} onClose={() => setResultOpen(false)} game={game} result={result} bot={bot} botName={botName}
          termination={game.resigned ? null : live?.termination ?? null}
          improved={improved} kept={kept} gains={gains} onRematch={rematch} onRetry={retryFrom} onCopyPgn={copyPgn} onLobby={() => navigate('/play/bots')}
          reviewTo={explorePath({ fen: game.initialFen, moves: game.moves.map(m => m.uci), base: game.moves.length, from: '/play', flipped })} />
      )}
    </>
  );
}

function OpponentCard({ bot }: { bot: Bot }) {
  return (
    <div className="opponent-card">
      {(bot.avatar ?? bot.portrait) && <img src={bot.avatar ?? bot.portrait} alt="" width="56" height="56" />}
      <div>
        <strong>{bot.name}</strong>
        <small>{bot.elo} · {bot.kind}</small>
        {bot.hello && <p>“{bot.hello}”</p>}
      </div>
    </div>
  );
}

function ResultDialog({ open, onClose, game, result, bot, botName, termination, improved, kept, gains, onRematch, onRetry, onCopyPgn, onLobby, reviewTo }: {
  open: boolean; onClose: () => void; game: PlaySave; result: string; bot?: Bot; botName: string; termination: string | null;
  improved: boolean; kept: { event: string; count: number; need: number; crest: boolean } | null; gains: AwardGain[]; onRetry: (fen: string) => void; onCopyPgn: () => void;
  onRematch: () => void; onLobby: () => void; reviewTo: string;
}) {
  const { t } = useTranslation('play');
  const outcome = outcomeFor(result, game.playerColor);
  const goals = starGoals(result, game.playerColor, yourMoveCount(game));
  const stars = starCount(goals);
  const title = outcome === 'win' ? t('result.won') : outcome === 'draw' ? t('result.draw') : game.resigned ? t('result.resigned') : t('result.botWon', { name: botName });
  const quote = outcome === 'win' ? bot?.lose : outcome === 'loss' ? bot?.win : undefined;
  const coach = outcome === 'win' ? { pose: 'dancing' as const, line: t('result.coachWin') }
    : outcome === 'draw' ? { pose: 'relieved' as const, line: t('result.coachDraw') }
    : game.resigned ? { pose: 'sad' as const, line: t('result.coachResigned') }
    : { pose: 'hug' as const, line: t('result.coachLoss') };
  return (
    <Dialog id="result-dialog" open={open} onClose={onClose}>
      <div className="result-card">
        <button type="button" className="icon-button result-close" aria-label={t('result.close')} onClick={onClose}>×</button>
        {outcome === 'draw'
          ? <Mascot pose="relieved" size={132} />
          : <img className={`result-figure${outcome === 'win' ? ' winner' : ''}`} src={figureSrc(game.playerColor, outcome === 'win' ? 'winner' : 'resigned')} alt="" width="132" height="132" />}
        <h2>{title}</h2>
        {game.coached ? <p className="result-practice">{t('coach.practiceGame', { count: game.takebacks ?? 0 })}</p> : <>
          <Stars count={stars} size={54} animate />
          <ul className="result-goals">
            {goals.map(goal => <li key={goal.label} className={goal.earned ? 'earned' : ''}><span aria-hidden="true">{goal.earned ? '★' : '☆'}</span>{goal.label}</li>)}
          </ul>
        </>}
        {outcome === 'draw' && termination && <DrawRule termination={termination} onNavigate={onClose} />}
        <p className="result-coach"><Mascot pose={coach.pose} size={44} /><span>{coach.line}</span></p>
        {improved && <p className="result-best">{t('result.newBest', { name: botName })}</p>}
        {kept && <p className="result-best result-kept">{kept.crest
          ? t('result.eventCrest', { title: eventTitle(kept.event) })
          : t('result.eventKept', { name: botName, title: eventTitle(kept.event), count: kept.count, need: kept.need })}</p>}
        {gains.length > 0 && (
          <div className="result-awards" aria-label={t('result.awardsLabel')}>
            <p className="result-awards-title"><img src="art/ui3d/reward.webp" alt="" width="26" height="26" />{t('result.newAwards')}</p>
            {gains.map(gain => (
              <Link key={gain.id} to="/awards" className={`result-award tier-${gain.tier}`} onClick={onClose}>
                <img src={badgeImage(gain.id, gain.tier)} alt="" width="52" height="52" />
                {gain.tier === 'unlocked' && <img className="result-award-unlocked" src="art/ui3d/unlocked.webp" alt="" width="20" height="20" />}
                <span><strong>{gain.title}</strong><small>{gain.tier === 'unlocked' ? t('result.awardUnlocked') : t('result.tierReached', { tier: TIER_NAMES[gain.tier] })}</small></span>
              </Link>
            ))}
          </div>
        )}
        {open && <BotReport game={game} botName={botName} onRetry={onRetry} />}
        {quote && bot && (
          <p className="result-quote">{bot.avatar && <img src={bot.avatar} alt="" width="36" height="36" />}<span>“{quote}”<small>{bot.name}</small></span></p>
        )}
        <div className="result-actions">
          <button type="button" className="button primary" onClick={onRematch}>{t('result.rematch')}</button>
          <Link className="button" to={reviewTo} onClick={onClose}>{t('result.review')}</Link>
          <button type="button" className="button" onClick={onCopyPgn}>{t('game.copyPgn')}</button>
          <button type="button" className="button" onClick={onLobby}>{t('result.anotherOpponent')}</button>
        </div>
      </div>
    </Dialog>
  );
}
