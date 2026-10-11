// /train/mistakes/:id — replay an analyzed game and find a better move at each of your errors.
// /train/guess/:master/:game — replay a legend's game and guess their moves (trainer.py).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { ChessBoard } from '../components/ChessBoard';
import { usePosition } from '../hooks/useChess';
import { useMasters } from '../hooks/useMasters';
import { usePlanning } from '../hooks/usePlanning';
import { api } from '../lib/api';
import { displayDate } from '../lib/format';
import { gamePath, guessPath } from '../lib/routes';
import { useGameData, useToast } from '../state/AppData';
import { ExplainMove } from '../components/CoachExplain';
import type { Color, EngineResult, Judgment, Move } from '../types';

const NO_MOVES: Move[] = [];

export interface MistakeStop {
  ply: number; move_number: number; class: Judgment; played: string; played_san: string;
  fen: string; best: string; best_san: string;
}
interface Walkthrough {
  id: string | number; initialFen: string; moves: Move[]; mistakes: MistakeStop[];
  user_color: Color | null; opponent: string | null; date: string | null;
  progress: { best: number; total: number; runs: number } | null;
}
interface JudgeResult { verdict: 'good' | 'worse'; loss: number; line: string[]; uci: string[] }
interface Answer { kind: 'found' | 'missed' | 'same' | 'revealed'; uci?: string; san?: string; judge?: JudgeResult }

const REPLAY_STEP_MS = 350;
const OPPONENT_DELAY_MS = 600;

const turnAt = (initialFen: string, ply: number): Color =>
  ((initialFen.split(' ')[1] === 'b' ? 1 : 0) + ply) % 2 ? 'black' : 'white';

function useLoad<T>(path: string | null) {
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string | null }>({ path: null, data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!path) return;
    setState({ path, data: null, error: null });
    const controller = new AbortController();
    api<T>(path, undefined, controller.signal)
      .then(data => setState({ path, data, error: null }))
      .catch(error => { if (!controller.signal.aborted) setState({ path, data: null, error: (error as Error).message }); });
    return () => controller.abort();
  }, [path, attempt]);
  const fresh = state.path === path;
  return { data: fresh ? state.data : null, error: fresh ? state.error : null, retry: () => setAttempt(n => n + 1) };
}

export function MistakesPage() {
  const { t } = useTranslation('trainer');
  const { id = '' } = useParams();
  const [inaccuracies, setInaccuracies] = useState(false);
  const { data, error, retry } = useLoad<Walkthrough>(`api/trainer/mistakes/${encodeURIComponent(id)}${inaccuracies ? '?inaccuracies=1' : ''}`);

  useEffect(() => { document.body.dataset.page = 'train'; }, []);

  let content;
  if (error) content = <p className="train-empty" role="alert">{error} <button type="button" className="text-button" onClick={retry}>{t('tryAgain')}</button></p>;
  else if (!data) content = <p className="train-empty" role="status">{t('loading')}</p>;
  else content = <Walk key={`${id}-${inaccuracies}`} data={data} />;

  return (
    <section id="trainer-mistakes" className="train" aria-label={t('mistakes.label')}>
      <header className="lesson-header">
        <h2>{t('mistakes.title')}</h2>
        {data && <p className="train-source">{t('mistakes.source', { opponent: data.opponent || t('mistakes.unknownOpponent'), date: displayDate(data.date) })}</p>}
        <label><input type="checkbox" checked={inaccuracies} onChange={e => setInaccuracies(e.target.checked)} /> {t('mistakes.inaccuracies')}</label>
      </header>
      {content}
    </section>
  );
}

function Walk({ data }: { data: Walkthrough }) {
  const { t } = useTranslation('trainer');
  const toast = useToast();
  const { engineAvailable } = useGameData();
  const stops = data.mistakes;
  const [index, setIndex] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [outcomes, setOutcomes] = useState<(boolean | null)[]>(() => stops.map(() => null));
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [bestLine, setBestLine] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ best: number; total: number; runs: number } | null>(data.progress);
  const posted = useRef(false);

  const stop = stops[index] ?? null;
  const done = index >= stops.length;
  const target = stop ? stop.ply - 1 : data.moves.length;
  const shownMoves = useMemo(() => data.moves.slice(0, cursor), [data.moves, cursor]);
  const { board, current } = usePosition(data.initialFen, shownMoves);
  const replaying = cursor !== target || !current;
  const planning = usePlanning(board);
  const found = outcomes.filter(Boolean).length;

  // Play the game forward to the next error, one move at a time.
  useEffect(() => {
    if (cursor === target || done) return;
    const timer = setTimeout(() => setCursor(c => (c < target ? c + 1 : target)), REPLAY_STEP_MS);
    return () => clearTimeout(timer);
  }, [cursor, target, done]);

  useEffect(() => {
    if (!done || posted.current || !stops.length) return;
    posted.current = true;
    api<{ best: number; total: number; runs: number }>('api/trainer/mistakes/result', { gameId: data.id, found, total: stops.length })
      .then(setSaved).catch(e => toast((e as Error).message));
  }, [done, data.id, found, stops.length, toast]);

  const prefix = (s: MistakeStop) => data.moves.slice(0, s.ply - 1).map(m => m.uci);

  function settle(s: MistakeStop, result: boolean, next: Answer) {
    setOutcomes(list => list.map((v, i) => (i === index && v === null ? result : v)));
    setAnswer(next);
    if (!result || next.uci !== s.best) {
      api<EngineResult>('api/engine', { initialFen: data.initialFen, moves: prefix(s) })
        .then(r => setBestLine(r.lines[0]?.moves ?? null)).catch(() => setBestLine(null));
    }
  }

  async function play(uci: string) {
    if (!stop || answer || replaying) return;
    if (uci === stop.played) { settle(stop, false, { kind: 'same', uci, san: stop.played_san }); return; }
    setBusy(true);
    try {
      const judged = await api<JudgeResult>('api/judge', { initialFen: data.initialFen, moves: prefix(stop), move: uci, expected: stop.best });
      const good = judged.verdict === 'good';
      settle(stop, good, { kind: good ? 'found' : 'missed', uci, san: judged.line[0] ?? uci, judge: judged });
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }

  const next = () => { setIndex(i => i + 1); setAnswer(null); setBestLine(null); };
  const restart = () => {
    posted.current = false;
    setIndex(0); setCursor(0); setOutcomes(stops.map(() => null)); setAnswer(null); setBestLine(null);
  };

  if (!stops.length) {
    return (
      <div className="train-done">
        <p>{t('mistakes.none')}</p>
        <Link className="button" to={gamePath(data.id)}>{t('mistakes.backToGame')}</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="train-done" id="mistakes-summary">
        <h2>{t('mistakes.summaryTitle')}</h2>
        <p>{t('mistakes.summary', { found, total: stops.length })}</p>
        {saved && <p className="train-detail">{t('mistakes.previous', saved)}</p>}
        <ul>
          {stops.map((s, i) => (
            <li key={s.ply}>
              <span aria-hidden="true">{outcomes[i] ? '✓ ' : '✗ '}</span>
              {t('mistakes.item', { number: s.move_number, played: s.played_san, best: s.best_san })}
            </li>
          ))}
        </ul>
        <div className="train-actions">
          <button className="button primary" type="button" onClick={restart}>{t('mistakes.restart')}</button>
          <Link className="text-button" to={gamePath(data.id)}>{t('mistakes.backToGame')}</Link>
        </div>
      </div>
    );
  }

  const side = turnAt(data.initialFen, stop.ply - 1);
  const flipped = (data.user_color ?? side) === 'black';
  const userMove = answer?.uci && answer.kind !== 'revealed' ? [answer.uci.slice(0, 2), answer.uci.slice(2, 4)] : [];
  const lineText = (moves: string[] | null | undefined) => (moves ?? []).join(' ');
  const strong = { strong: <strong /> };
  let verdict = null;
  if (answer?.kind === 'found') {
    verdict = answer.uci === stop.best
      ? <Trans t={t} i18nKey="mistakes.foundBest" values={{ move: answer.san }} components={strong} />
      : <Trans t={t} i18nKey="mistakes.foundAlso" values={{ move: answer.san, best: stop.best_san }} components={strong} />;
  } else if (answer?.kind === 'missed') {
    verdict = <Trans t={t} i18nKey="mistakes.missed" values={{ move: answer.san, loss: `${answer.judge?.loss ?? 0} cp`, line: lineText(answer.judge?.line) }} components={strong} />;
  } else if (answer?.kind === 'same') {
    verdict = <Trans t={t} i18nKey="mistakes.same" values={{ move: answer.san }} components={strong} />;
  }

  return (
    <div className="train-layout">
      <div className="train-board-column">
        <ChessBoard board={board} flipped={flipped} planning={planning} lastMove={data.moves[cursor - 1]?.uci ?? null}
          movable={answer || replaying || !engineAvailable ? false : side} onMove={play} busy={busy}
          highlight={userMove} bestMove={answer && answer.kind !== 'found' ? stop.best : null} />
      </div>
      <aside className="train-panel" aria-live="polite">
        <p className="train-source">{t('mistakes.progress', { current: index + 1, total: stops.length, found })}</p>
        {replaying ? <p className="train-prompt" role="status">{t('mistakes.replaying')}</p> : !answer ? <>
          <p className="train-prompt"><Trans t={t} i18nKey="mistakes.prompt" components={strong}
            values={{ side: t(side === 'white' ? 'mistakes.white' : 'mistakes.black'), played: stop.played_san, class: stop.class }} />
            {!engineAvailable && ` ${t('noEngine')}`}</p>
          <div className="train-actions">
            <button className="text-button" type="button" onClick={() => settle(stop, false, { kind: 'revealed' })}>{t('mistakes.showAnswer')}</button>
          </div>
        </> : <>
          {verdict && <p className={`train-verdict ${answer.kind === 'found' ? 'correct' : 'missed'}`}>{verdict}</p>}
          {answer.kind !== 'found' && <p className="train-detail"><Trans t={t} i18nKey="mistakes.revealed" values={{ best: stop.best_san }} components={strong} /></p>}
          {bestLine && bestLine.length > 0 && <p className="train-detail">{t('mistakes.bestLine', { line: lineText(bestLine) })}</p>}
          <ExplainMove fen={stop.fen} move={stop.played} />
          <div className="train-actions">
            <button className="button primary" type="button" onClick={next}>{index + 1 < stops.length ? t('mistakes.next') : t('mistakes.finish')}</button>
            {answer.kind !== 'found' && <button className="text-button" type="button" onClick={() => { setAnswer(null); setBestLine(null); }}>{t('mistakes.retry')}</button>}
          </div>
        </>}
      </aside>
    </div>
  );
}

// ---- Guess the move ----

interface MasterGameRow { index: number; white: string; black: string; side: Color; year: number | null; result: string; event: string; moves: number; best: number | null }
interface MasterGames { master: { id: string; name: string }; games: MasterGameRow[] }
interface MasterGame {
  index: number; master: string; name: string; side: Color; initialFen: string; moves: Move[];
  white: string; black: string; year: number | null; result: string; event: string;
  progress: { best: number; runs: number } | null;
}
interface GuessResult {
  exact: boolean; critical: boolean; san: string; master: string; master_san: string;
  best: string; best_san: string; points: number; loss: number;
}

const GUESS_POINTS = 10;
const LIST_LIMIT = 60;

export function GuessMovePage() {
  const { t } = useTranslation('trainer');
  const { master, game } = useParams();
  useEffect(() => { document.body.dataset.page = 'train'; }, []);
  const index = game !== undefined && /^\d+$/.test(game) ? Number(game) : undefined;
  return (
    <section id="trainer-guess" className="train" aria-label={t('guess.label')}>
      <header className="lesson-header">
        <h2>{t('guess.title')}</h2>
        {master && <Link className="text-button" to={guessPath()}>{t('guess.allLegends')}</Link>}
      </header>
      {!master ? <LegendPicker /> : index === undefined ? <GameList master={master} /> : <GuessGame key={`${master}/${index}`} master={master} index={index} />}
    </section>
  );
}

function LegendPicker() {
  const { t } = useTranslation('trainer');
  const { masters, loaded } = useMasters();
  if (!loaded) return <p className="train-empty" role="status">{t('loading')}</p>;
  if (!masters.length) return <p className="train-empty">{t('guess.noLegends')}</p>;
  return (
    <section className="lesson-group">
      <p className="train-prompt">{t('guess.pickLegend')}</p>
      <div className="lesson-cards">
        {masters.map(m => (
          <Link key={m.id} className="lesson-card" to={guessPath(m.id)}>
            <span className="lesson-meta">{t('guess.legendGames', { count: m.games })}</span>
            <h3>{m.name}</h3>
          </Link>
        ))}
      </div>
    </section>
  );
}

function GameList({ master }: { master: string }) {
  const { t } = useTranslation('trainer');
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const { data, error, retry } = useLoad<MasterGames>(`api/trainer/masters/${encodeURIComponent(master)}`);
  if (error) return <p className="train-empty" role="alert">{error} <button type="button" className="text-button" onClick={retry}>{t('tryAgain')}</button></p>;
  if (!data) return <p className="train-empty" role="status">{t('loading')}</p>;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = data.games.filter(g => {
    const text = `${g.white} ${g.black} ${g.event} ${g.year ?? ''}`.toLowerCase();
    return words.every(w => text.includes(w));
  });
  const random = () => { if (matches.length) navigate(guessPath(master, matches[Math.floor(Math.random() * matches.length)].index)); };
  return (
    <section className="lesson-group" aria-labelledby="guess-games-title">
      <h3 id="guess-games-title">{data.master.name}</h3>
      <div className="train-actions">
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label={t('guess.search')} placeholder={t('guess.search')} />
        <button type="button" className="button primary" onClick={random} disabled={!matches.length}>{t('guess.random')}</button>
      </div>
      <p className="train-detail">{t('guess.matches', { shown: Math.min(LIST_LIMIT, matches.length), total: matches.length })}</p>
      <div className="lesson-cards">
        {matches.slice(0, LIST_LIMIT).map(g => (
          <Link key={g.index} className="lesson-card" to={guessPath(master, g.index)}>
            <span className="lesson-meta">{t('guess.gameMeta', { event: g.event || '?', year: g.year ?? '?', moves: g.moves, result: g.result })}</span>
            <h3>{t('guess.vs', { white: g.white, black: g.black })}</h3>
            {g.best != null && <span className="lesson-status">{t('guess.best', { score: g.best })}</span>}
          </Link>
        ))}
      </div>
    </section>
  );
}

function GuessGame({ master, index }: { master: string; index: number }) {
  const { t } = useTranslation('trainer');
  const toast = useToast();
  const { engineAvailable } = useGameData();
  const { data, error, retry } = useLoad<MasterGame>(`api/trainer/masters/${encodeURIComponent(master)}/${index}`);
  const [side, setSide] = useState<Color | null>(null);
  const [started, setStarted] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [score, setScore] = useState({ points: 0, max: 0, critical: 0 });
  const [feedback, setFeedback] = useState<GuessResult | null>(null);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ best: number; runs: number; improved?: boolean } | null>(null);
  const posted = useRef(false);

  const moves = data?.moves ?? NO_MOVES;
  const initialFen = data?.initialFen ?? '';
  const playing: Color = side ?? data?.side ?? 'white';
  const finished = started && !!data && cursor >= moves.length;
  const turn = data ? turnAt(initialFen, cursor) : 'white';
  const shownMoves = useMemo(() => moves.slice(0, cursor), [moves, cursor]);
  const { board, current } = usePosition(initialFen, shownMoves, !!data);
  const planning = usePlanning(board);

  useEffect(() => { if (data) setSaved(data.progress); }, [data]);

  // The other side's moves play themselves.
  useEffect(() => {
    if (!started || paused || finished || turn === playing) return;
    const timer = setTimeout(() => setCursor(c => c + 1), OPPONENT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [started, paused, finished, turn, playing, cursor]);

  useEffect(() => {
    if (!finished || posted.current || !score.max) return;
    posted.current = true;
    api<{ best: number; runs: number; improved: boolean }>('api/trainer/masters/result', { masterId: master, index, score: score.points, max: score.max })
      .then(setSaved).catch(e => toast((e as Error).message));
  }, [finished, master, index, score, toast]);

  const guess = useCallback(async (uci: string) => {
    if (!data || !current || busy || paused || finished || turn !== playing) return;
    setBusy(true);
    try {
      const result = await api<GuessResult>('api/trainer/guess', {
        initialFen, moves: moves.slice(0, cursor).map(m => m.uci), move: uci, expected: moves[cursor].uci });
      setScore(s => ({ points: s.points + result.points, max: s.max + GUESS_POINTS, critical: s.critical + (result.critical ? 1 : 0) }));
      setFeedback(result);
      if (result.critical) setPaused(true);
      else setCursor(c => c + 1);
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }, [data, current, busy, paused, finished, turn, playing, initialFen, moves, cursor, toast]);

  if (error) return <p className="train-empty" role="alert">{error} <button type="button" className="text-button" onClick={retry}>{t('tryAgain')}</button></p>;
  if (!data) return <p className="train-empty" role="status">{t('loading')}</p>;

  const player = playing === 'white' ? data.white : data.black;
  const strong = { strong: <strong /> };
  const restart = () => {
    posted.current = false;
    setCursor(0); setScore({ points: 0, max: 0, critical: 0 }); setFeedback(null); setPaused(false); setStarted(true);
  };
  const heading = (
    <p className="train-source">{t('guess.vs', { white: data.white, black: data.black })} · {t('guess.gameMeta', { event: data.event || '?', year: data.year ?? '?', moves: Math.ceil(moves.length / 2), result: data.result })}</p>
  );

  let panel;
  if (!started) {
    panel = <>
      {heading}
      <label className="train-prompt">{t('guess.playAs')}{' '}
        <select value={playing} onChange={e => setSide(e.target.value as Color)}>
          <option value="white">{data.white}</option>
          <option value="black">{data.black}</option>
        </select>
      </label>
      {!engineAvailable && <p className="train-detail">{t('noEngine')}</p>}
      <div className="train-actions">
        <button className="button primary" type="button" onClick={() => setStarted(true)} disabled={!engineAvailable}>{t('guess.start')}</button>
      </div>
    </>;
  } else if (finished) {
    const percent = score.max ? Math.round((100 * score.points) / score.max) : 0;
    panel = <div id="guess-summary">
      {heading}
      <h3>{t('guess.doneTitle')}</h3>
      <p>{t('guess.done', { score: score.points, max: score.max, percent })}</p>
      {score.critical > 0 && <p className="train-detail">{t('guess.criticalCount', { count: score.critical })}</p>}
      {saved?.improved && <p className="train-verdict correct">{t('guess.newBest')}</p>}
      {saved && <p className="train-detail">{t('guess.previous', saved)}</p>}
      <div className="train-actions">
        <button className="button primary" type="button" onClick={restart}>{t('guess.again')}</button>
        <Link className="text-button" to={guessPath(master)}>{t('guess.otherGame')}</Link>
      </div>
    </div>;
  } else {
    let said = null;
    if (feedback) {
      const values = { move: feedback.san, master: feedback.master_san, player, loss: feedback.loss, points: feedback.points };
      said = <p className={`train-verdict ${feedback.points >= GUESS_POINTS / 2 ? 'correct' : 'missed'}`}>
        <Trans t={t} i18nKey={feedback.exact ? 'guess.exact' : feedback.loss ? 'guess.close' : 'guess.better'} values={values} components={strong} /></p>;
    }
    panel = <>
      {heading}
      <p className="train-source" id="guess-score">{t('guess.score', { score: score.points, max: score.max })}</p>
      {said}
      {paused && feedback ? <>
        <p className="train-prompt"><Trans t={t} i18nKey="guess.critical" values={{ master: feedback.master_san }} components={strong} /></p>
        <div className="train-actions">
          <button className="button primary" type="button" onClick={() => { setPaused(false); setCursor(c => c + 1); }}>{t('guess.continue')}</button>
        </div>
      </> : <p className="train-prompt">{turn === playing && current
        ? <Trans t={t} i18nKey="guess.yourTurn" values={{ player }} components={strong} />
        : t('guess.waiting')}</p>}
    </>;
  }

  const masterMove = paused && feedback ? feedback.master : null;
  return (
    <div className="train-layout">
      <div className="train-board-column">
        <ChessBoard board={board} flipped={playing === 'black'} planning={planning} lastMove={moves[cursor - 1]?.uci ?? null}
          movable={started && current && !finished && !paused && !busy && turn === playing && engineAvailable ? playing : false}
          onMove={guess} busy={busy} bestMove={masterMove} />
      </div>
      <aside className="train-panel" aria-live="polite">{panel}</aside>
    </div>
  );
}
