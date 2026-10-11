// /puzzles — rated puzzles by theme from the Lichess database (puzzles.py), with every miss tracked, plus the unrated Streak and Storm runs.
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChessBoard } from '../components/ChessBoard';
import { Segments } from '../components/Segments';
import { usePuzzleSolver, type PuzzleSolve } from '../hooks/usePuzzleSolver';
import { usePosition } from '../hooks/useChess';
import { hardMode, puzzleAutoNext, puzzleBlindfold, puzzleHelp, showRatings } from '../lib/settings';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { explorePath, puzzlePath, PUZZLE_MISSED, PUZZLE_MIXED, PUZZLE_STORM, PUZZLE_STREAK, PUZZLE_WEAK } from '../lib/routes';
import { useToast } from '../state/AppData';
import type { Puzzle, PuzzleAttempt, PuzzleCatalog, PuzzleRunMode, PuzzleRunResult, PuzzleTheme } from '../types';
import { moveLabel } from './LessonsPage';
import { brandIcon, Mascot } from '../components/Reward';
import { CursorRook } from '../components/CursorRook';
import { PUZZLE_ART, PUZZLE_RATING_ART, PUZZLE_RETRY_ART } from '../lib/art';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSounds } from '../hooks/useSounds';
import { useNarration } from '../hooks/useNarration';
import i18n from '../i18n';

const STORM_SECONDS = 180;
const STORM_PENALTY = 10; // seconds off the Storm clock for a wrong move
const AUTO_NEXT_MS = 1800; // a clean solve's pause before the next puzzle, when it moves on by itself
const isRun = (theme?: string): theme is PuzzleRunMode => theme === PUZZLE_STREAK || theme === PUZZLE_STORM;

export function PuzzlesPage() {
  const { theme, id } = useParams();
  const { t } = useTranslation('puzzles');
  useEffect(() => { document.body.dataset.page = 'puzzles'; }, []);
  return (
    <section id="puzzles" className="puzzles" aria-label={t('page.label')}>
      {isRun(theme) ? <PuzzleRun key={theme} mode={theme} /> : theme ? <PuzzleStream key={theme} theme={theme} id={id} /> : <Overview />}
    </section>
  );
}

function useCatalog() {
  const [catalog, setCatalog] = useState<PuzzleCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setCatalog(await api<PuzzleCatalog>('api/puzzles')); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { catalog, error, load };
}

const percent = (part: number, whole: number) => whole ? Math.round(part / whole * 100) : 0;

function themeTitle(t: TFunction<'puzzles'>, catalog: PuzzleCatalog | null, theme: string) {
  if (theme === PUZZLE_MIXED) return t('titles.mixed');
  if (theme === PUZZLE_MISSED) return t('titles.missed');
  if (theme === PUZZLE_WEAK) return t('titles.weak');
  if (isRun(theme)) return t(`titles.${theme}`);
  return catalog?.themes.find(th => th.slug === theme)?.title ?? t('titles.fallback');
}

// ── Overview ───────────────────────────────────────────────────────────────

type ThemeFilter = 'all' | 'started' | 'new';
const FILTERS: ThemeFilter[] = ['all', 'started', 'new'];
const FILTER_LABEL = { all: 'overview.filterAll', started: 'overview.filterStarted', new: 'overview.filterNew' } as const;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;

function Overview() {
  const { t } = useTranslation('puzzles');
  const { catalog, error, load } = useCatalog();
  let body;
  if (error) body = <p className="puzzles-empty" role="alert">{error} <button type="button" className="text-button" onClick={load}>{t('overview.tryAgain')}</button></p>;
  else if (!catalog) body = <p className="puzzles-empty" role="status">{t('overview.loading')}</p>;
  else if (!catalog.total) body = <p className="puzzles-empty"><Trans t={t} i18nKey="overview.notInstalled" components={{ code: <code /> }} /></p>;
  else body = <OverviewBody catalog={catalog} />;
  return (
    <div className="puzzles-overview">
      <h1 className="puzzles-title">{t('page.label')}</h1>
      {body}
    </div>
  );
}

function OverviewBody({ catalog }: { catalog: PuzzleCatalog }) {
  const { t } = useTranslation('puzzles');
  const [showRules, setShowRules] = useState(false);
  const [filter, setFilter] = useState<ThemeFilter>('all');
  const [query, setQuery] = useState('');
  // The server picks the weak themes (puzzles.weak_themes), the same ones the "weak" batch draws from.
  const weak = (catalog.weak ?? []).flatMap(slug => catalog.themes.filter(th => th.slug === slug));
  const words = query.trim().toLowerCase();
  const shown = catalog.themes.filter(th =>
    (filter === 'all' || (filter === 'started') === th.attempted > 0)
    && (!words || `${th.title} ${th.summary}`.toLowerCase().includes(words)));
  const total = catalog.themes.length;
  const solved = catalog.recent.filter(a => a.result === 'solved').length;
  const best = (mode: PuzzleRunMode) => catalog.runs?.[mode].best ?? 0;

  return (
    <>
      <div className="puzzle-top">
        <RatingCard catalog={catalog} />
        <nav className="puzzle-modes" aria-label={t('overview.modesLabel')}>
          <Link className="puzzle-go" to={puzzlePath(PUZZLE_MIXED)}>
            <img src={PUZZLE_RATING_ART} alt="" width="44" height="44" />
            <span><strong>{t('overview.solveRated')}</strong><small>{t('overview.solveRatedSub', { rating: catalog.rating })}</small></span>
            <span className="puzzle-go-arrow" aria-hidden="true">→</span>
          </Link>
          <ModeTile to={puzzlePath(PUZZLE_MISSED)} art={PUZZLE_RETRY_ART} warm title={t('overview.retry')}
            sub={catalog.missed ? t('overview.retryDue', { count: catalog.missed }) : t('overview.retryNone')} />
          <ModeTile to={puzzlePath(PUZZLE_STREAK)} art={PUZZLE_ART.streak} title={t('titles.streak')} hint={t('run.streakRules')}
            sub={best(PUZZLE_STREAK) ? t('overview.streakSub', { best: best(PUZZLE_STREAK) }) : t('overview.streakNew')} />
          <ModeTile to={puzzlePath(PUZZLE_STORM)} art={PUZZLE_ART.storm} warm title={t('titles.storm')} hint={t('run.stormRules')}
            sub={best(PUZZLE_STORM) ? t('overview.stormSub', { best: best(PUZZLE_STORM) }) : t('overview.stormNew')} />
          {weak.length > 0 && <ModeTile to={puzzlePath(PUZZLE_WEAK)} art={PUZZLE_ART[weak[0].slug]} title={t('titles.weak')} sub={weak.map(th => th.title).join(', ')} />}
          <button type="button" className={`puzzle-rules-toggle${weak.length ? ' wide' : ''}`} aria-expanded={showRules} aria-controls="puzzle-rules" onClick={() => setShowRules(v => !v)}>
            {showRules ? t('overview.hideRules') : t('overview.showRules')} <span aria-hidden="true">{showRules ? '▴' : '▾'}</span>
          </button>
        </nav>
      </div>

      {showRules && (
        <div className="puzzle-rules" id="puzzle-rules">
          {(['first', 'help', 'miss', 'runs'] as const).map(key => (
            <div key={key}><strong>{t(`overview.rules.${key}Title`)}</strong><p>{t(`overview.rules.${key}Text`)}</p></div>
          ))}
        </div>
      )}

      <div className="puzzle-tools">
        <Segments className="bots-segments puzzle-filter" role="group" aria-label={t('overview.filterLabel')}>
          {FILTERS.map(key => (
            <button key={key} type="button" aria-pressed={filter === key} className={filter === key ? 'selected' : ''} onClick={() => setFilter(key)}>{t(FILTER_LABEL[key])}</button>
          ))}
        </Segments>
        <input type="search" className="puzzle-search" value={query} onChange={e => setQuery(e.target.value)}
          placeholder={t('overview.search')} aria-label={t('overview.searchLabel')} />
        <span className="puzzle-count" role="status">
          {shown.length === total ? t('overview.themeCount', { count: total }) : t('overview.themesShown', { shown: shown.length, total })}
        </span>
      </div>

      {catalog.groups.map(group => {
        const items = shown.filter(th => th.group === group);
        return items.length > 0 && (
          <section key={group} className="puzzle-group" aria-labelledby={`puzzles-${group}`}>
            <div className="puzzle-group-head">
              <h2 id={`puzzles-${group}`}>{t(`groups.${group}` as const)}</h2>
              <span>{t('overview.themeCount', { count: items.length })}</span>
            </div>
            <div className="puzzle-cards">{items.map(th => <ThemeCard key={th.slug} theme={th} />)}</div>
          </section>
        );
      })}
      {shown.length === 0 && <p className="puzzle-no-match">{t('overview.noMatch')}</p>}

      {catalog.recent.length > 0 && (
        <section className="puzzle-history" aria-labelledby="puzzle-history-title">
          <div className="puzzle-group-head">
            <h2 id="puzzle-history-title">{t('overview.recentTitle')}</h2>
            <span className="puzzle-count">{t('overview.recentSummary', { solved, missed: catalog.recent.length - solved })}</span>
          </div>
          <ol>{catalog.recent.map((a, i) => <AttemptRow key={`${a.id}-${a.at}-${i}`} attempt={a} />)}</ol>
        </section>
      )}

      {catalog.problems.length > 0 && (
        <details className="lesson-problems">
          <summary>{t('overview.problems', { count: catalog.problems.length })}</summary>
          <ul>{catalog.problems.map(p => <li key={p}>{p}</li>)}</ul>
        </details>
      )}
    </>
  );
}

function RatingCard({ catalog }: { catalog: PuzzleCatalog }) {
  const { t } = useTranslation('puzzles');
  const firstTries = catalog.themes.reduce((sum, th) => sum + th.solved_first, 0);
  const week = catalog.week ?? 0;
  return (
    <div className="puzzle-rating-card">
      <div className="puzzle-rating-main">
        <span className="puzzle-label">{t('overview.ratingLabel')}</span>
        <strong id="puzzle-rating">{catalog.rating}</strong>
        <span className="puzzle-sub">
          {catalog.rated ? t('overview.ratedCount', { count: catalog.rated }) : t('overview.provisional')}
          {week !== 0 && <> · <span className={week > 0 ? 'up' : 'down'}>{t('overview.week', { delta: signed(week) })}</span></>}
        </span>
      </div>
      <Trend points={catalog.trend} />
      {catalog.rated > 0 && (
        <dl className="puzzle-rating-stats">
          <div><dt>{t('overview.firstTry')}</dt><dd>{percent(firstTries, catalog.rated)}%</dd></div>
          {catalog.avg_seconds != null && <div><dt>{t('overview.avgSolve')}</dt><dd>{t('attempt.seconds', { seconds: catalog.avg_seconds })}</dd></div>}
        </dl>
      )}
    </div>
  );
}

function ModeTile({ to, art, title, sub, hint, warm }: { to: string; art?: string; title: string; sub: string; hint?: string; warm?: boolean }) {
  return (
    <Link className="puzzle-mode" to={to} title={hint}>
      <span className={`puzzle-mode-art${warm ? ' warm' : ''}`}>{art && <img src={art} alt="" width="26" height="26" />}</span>
      <span><strong>{title}</strong><small>{sub}</small></span>
    </Link>
  );
}

function Trend({ points }: { points: number[] }) {
  const { t } = useTranslation('puzzles');
  if (points.length < 2) return null;
  const low = Math.min(...points), high = Math.max(...points), span = high - low || 1;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${(i / (points.length - 1) * 300).toFixed(1)} ${(76 - (p - low) / span * 70).toFixed(1)}`).join(' ');
  return (
    <svg className="puzzle-trend" viewBox="0 0 300 80" preserveAspectRatio="none" role="img" aria-label={t('trend.label', { count: points.length, from: points[0], to: points.at(-1) })}>
      <path className="area" d={`${line} L300 80 L0 80 Z`} />
      <path className="line" d={line} />
    </svg>
  );
}

function ThemeCard({ theme }: { theme: PuzzleTheme }) {
  const { t } = useTranslation('puzzles');
  const stats = { tried: theme.attempted, percent: percent(theme.solved_first, theme.attempted), missed: theme.missed };
  const started = theme.attempted > 0;
  return (
    <Link className={`puzzle-card${started ? ' started' : ''}`} to={puzzlePath(theme.slug)}>
      <span className="puzzle-card-head">
        <span className="puzzle-card-art">{PUZZLE_ART[theme.slug] && <img src={PUZZLE_ART[theme.slug]} alt="" width="40" height="40" loading="lazy" />}</span>
        <span>
          <h3>{theme.title}</h3>
          <span className="puzzle-card-meta">{t('themeCard.meta', { count: theme.count, low: theme.low, high: theme.high })}</span>
        </span>
      </span>
      <p>{theme.summary}</p>
      <span className="puzzle-card-progress" aria-hidden="true"><i style={{ width: `${percent(theme.attempted, theme.count)}%` }} /></span>
      <span className="puzzle-card-foot">
        <span className="puzzle-card-status">{started ? t(theme.missed ? 'themeCard.statusWithMissed' : 'themeCard.status', stats) : t('themeCard.notStarted')}</span>
        <span className="puzzle-card-cta">{started ? t('themeCard.continue') : t('themeCard.start')}</span>
      </span>
    </Link>
  );
}

function AttemptRow({ attempt }: { attempt: PuzzleAttempt }) {
  const { t } = useTranslation('puzzles');
  const solved = attempt.result === 'solved';
  const help = [attempt.hint && t('attempt.hint'), attempt.revealed && t('attempt.solutionShown')].filter(Boolean).join(', ');
  return (
    <li className={`puzzle-attempt ${attempt.result}`}>
      <span className="puzzle-attempt-mark" aria-label={solved ? t('attempt.solved') : t('attempt.missed')}>{solved ? '✓' : '✕'}</span>
      <span className="puzzle-attempt-what">
        <Link to={puzzlePath(PUZZLE_MIXED, attempt.id)}>{attempt.themes?.join(', ') || t('attempt.puzzle')}</Link>
        {(attempt.misses.length > 0 || help) && (
          <span className="puzzle-attempt-detail">
            {attempt.misses.length > 0 && t('attempt.tried', { moves: attempt.misses.join(', ') })}
            {attempt.misses.length > 0 && help && ' · '}{help}
          </span>
        )}
      </span>
      <span className="puzzle-attempt-meta">{attempt.puzzle_rating}{attempt.seconds != null && ` · ${t('attempt.seconds', { seconds: attempt.seconds })}`} · {relativeTime(attempt.at)}</span>
      <span className={`puzzle-delta${attempt.delta > 0 ? ' up' : attempt.delta < 0 ? ' down' : ''}`}>
        {attempt.rated ? signed(attempt.delta) : t('attempt.unrated')}
      </span>
    </li>
  );
}

// ── Solving ────────────────────────────────────────────────────────────────

function PuzzleStream({ theme, id }: { theme: string; id?: string }) {
  const { t } = useTranslation('puzzles');
  const navigate = useNavigate();
  const { catalog } = useCatalog();
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const ratingsShown = showRatings.use();
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (catalog) setRating(r => r ?? catalog.rating); }, [catalog]);

  const pick = useCallback(async (after?: string) => {
    setError(null);
    try {
      const query = new URLSearchParams({ theme, ...(after ? { after } : {}) });
      const next = await api<{ id: string | null }>(`api/puzzles/next?${query}`);
      if (next.id) navigate(puzzlePath(theme, next.id), { replace: !after });
      else setEmpty(true);
    } catch (e) { setError((e as Error).message); }
  }, [navigate, theme]);

  useEffect(() => { if (!id) void pick(); }, [id, pick]);
  useEffect(() => {
    if (!id) return;
    let live = true;
    setPuzzle(null);
    setEmpty(false);
    api<Puzzle>(`api/puzzles/${encodeURIComponent(id)}`)
      .then(p => { if (live) setPuzzle(p); })
      .catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [id]);

  const title = themeTitle(t, catalog, theme);
  // The top bar reads "Puzzles / Forks"; its "Puzzles" is the way back to every theme.
  usePageTitle({ title, art: PUZZLE_ART[theme] });
  let body;
  if (error) body = <p className="puzzles-empty" role="alert">{error} <Link className="text-button" to={puzzlePath()}>{t('stream.allPuzzles')}</Link></p>;
  else if (empty) {
    body = (
      <div className="lesson-finished">
        <Mascot pose="happy" size={96} />
        <h3>{theme === PUZZLE_MISSED ? t('stream.emptyMissedTitle') : t('stream.emptyAllTitle')}</h3>
        <p>{theme === PUZZLE_MISSED ? t('stream.emptyMissedBody') : t('stream.emptyAllBody')}</p>
        <div className="lesson-actions">
          <Link className="button primary" to={puzzlePath(PUZZLE_MIXED)}>{t('stream.ratedPuzzles')}</Link>
          <Link className="button" to={puzzlePath()}>{t('stream.allPuzzles')}</Link>
        </div>
      </div>
    );
  } else if (!puzzle) body = <p className="puzzles-empty" role="status">{t('stream.loading')}</p>;
  else body = <Solver key={puzzle.id} puzzle={puzzle} theme={theme} onNext={() => pick(puzzle.id)} onResult={r => setRating(r.rating)} />;

  return (
    <>
      {rating !== null && ratingsShown && (
        <header className="lesson-header puzzle-header">
          <span className="lesson-count puzzle-header-rating">{t('stream.yourRating', { rating })}</span>
        </header>
      )}
      {body}
    </>
  );
}

/** Streak (no mistakes, rising difficulty) or Storm (STORM_SECONDS to solve as many as possible): unrated runs. */
function PuzzleRun({ mode }: { mode: PuzzleRunMode }) {
  const { t } = useTranslation('puzzles');
  const toast = useToast();
  const { catalog } = useCatalog();
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [score, setScore] = useState(0);
  const [left, setLeft] = useState(STORM_SECONDS);
  const [penalized, setPenalized] = useState(false);
  const [over, setOver] = useState<{ score: number; tried?: string; answer?: string; result?: PuzzleRunResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const served = useRef<string[]>([]);
  const points = useRef(0);
  const ended = useRef(false);
  const deadline = useRef(0);
  usePageTitle({ title: t(`titles.${mode}`) });

  const finish = useCallback(async (tried?: string, answer?: string) => {
    if (ended.current) return;
    ended.current = true;
    const final = points.current;
    setOver({ score: final, tried, answer });
    try {
      const result = await api<PuzzleRunResult>('api/puzzles/run', { mode, score: final });
      setOver(o => o && { ...o, result });
    } catch (e) { toast((e as Error).message); }
  }, [mode, toast]);

  // The next puzzle climbs with the number served; none from this run comes back.
  const next = useCallback(async () => {
    setError(null);
    try {
      const query = new URLSearchParams({ run: mode, index: String(served.current.length) });
      if (served.current.length) query.set('exclude', served.current.join(','));
      const found = await api<{ id: string | null }>(`api/puzzles/next?${query}`);
      if (ended.current) return;
      if (!found.id) return void finish();
      const p = await api<Puzzle>(`api/puzzles/${encodeURIComponent(found.id)}`);
      if (ended.current) return;
      served.current = [...served.current, p.id];
      setPuzzle(p);
    } catch (e) { setError((e as Error).message); }
  }, [mode, finish]);

  const start = useCallback(() => {
    served.current = []; points.current = 0; ended.current = false;
    deadline.current = Date.now() + STORM_SECONDS * 1000;
    setScore(0); setLeft(STORM_SECONDS); setPenalized(false); setOver(null); setPuzzle(null);
    void next();
  }, [next]);
  useEffect(() => { start(); }, [start]);

  useEffect(() => {
    if (mode !== PUZZLE_STORM || over) return;
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setLeft(remaining);
      if (!remaining) void finish();
    }, 250);
    return () => clearInterval(timer);
  }, [mode, over, finish]);

  const run = useMemo(() => ({
    onSolve: () => { points.current += 1; setScore(points.current); setPenalized(false); void next(); },
    onFail: (tried: string, answer: string) => {
      if (mode === PUZZLE_STREAK) return void finish(tried, answer);
      deadline.current -= STORM_PENALTY * 1000;
      setLeft(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)));
      setPenalized(true);
      void next();
    },
  }), [mode, next, finish]);

  const best = catalog?.runs?.[mode].best ?? 0;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  let body;
  if (error) body = <p className="puzzles-empty" role="alert">{error} <button type="button" className="text-button" onClick={start}>{t('overview.tryAgain')}</button></p>;
  else if (over) {
    body = (
      <div className="lesson-finished" id="puzzle-run-over">
        <Mascot pose={over.result?.new_best ? 'happy' : 'thinking'} size={96} />
        <h3>{mode === PUZZLE_STORM ? t('run.timeUp') : t('run.over')}</h3>
        <p>
          {t('run.final', { count: over.score })}
          {over.tried && over.answer && <> {t('run.missedMove', { tried: over.tried, answer: over.answer })}</>}
        </p>
        {over.result && <p className="puzzle-sub">{over.result.new_best ? t('run.newBest') : t('run.best', { best: over.result.best })}</p>}
        <div className="lesson-actions">
          <button type="button" className="button primary" onClick={start}>{t('run.again')}</button>
          <Link className="button" to={puzzlePath()}>{t('stream.allPuzzles')}</Link>
        </div>
      </div>
    );
  } else if (!puzzle) body = <p className="puzzles-empty" role="status">{t('stream.loading')}</p>;
  else body = <Solver key={puzzle.id} puzzle={puzzle} theme={mode} run={run} onNext={() => {}} onResult={() => {}} />;

  return (
    <>
      <header className="lesson-header puzzle-header">
        {mode === PUZZLE_STORM && <span className="lesson-count puzzle-header-rating" id="puzzle-run-clock" aria-label={t('run.clockLabel', { time: clock })}>{clock}</span>}
        <span className="lesson-count puzzle-header-rating" id="puzzle-run-score">{t('run.score', { score })}</span>
        {penalized && !over && <span className="puzzle-delta down" role="status">{t('run.penalty', { seconds: STORM_PENALTY })}</span>}
        {best > 0 && <span className="puzzle-sub">{t('run.best', { best })}</span>}
        {!over && <button type="button" className="text-button" onClick={() => void finish()}>{t('run.end')}</button>}
      </header>
      {!over && <p className="puzzle-sub">{t(`run.${mode}Rules`)}</p>}
      {body}
    </>
  );
}

/** One side's pieces in words, "Kg1, Re1, b2, f2" (pawns as bare squares); `letters` is K, Q, R, B, N in the language. */
export function piecesInWords(fen: string, white: boolean, letters = 'KQRBN') {
  const found: [number, string][] = [];
  fen.split(' ')[0].split('/').forEach((row, r) => {
    let file = 0;
    for (const c of row) {
      if (/\d/.test(c)) { file += Number(c); continue; }
      if ((c === c.toUpperCase()) === white) {
        const order = 'kqrbnp'.indexOf(c.toLowerCase());
        found.push([order * 100 + file * 10 + (8 - r), `${order < 5 ? letters[order] : ''}${'abcdefgh'[file]}${8 - r}`]);
      }
      file += 1;
    }
  });
  return found.sort((a, b) => a[0] - b[0]).map(([, name]) => name).join(', ');
}

// What the coach says when a puzzle ends or a move misses (coach.* in puzzles.json); picked by the puzzle, so it varies.
const lineFor = (lines: string[], key: string) => lines[[...key].reduce((sum, c) => sum + c.charCodeAt(0), 0) % lines.length];

/** The coach's quips for a moment (voice.json, written natively per language). */
export type VoiceMoment = 'capture' | 'check' | 'mate' | 'wrong' | 'great' | 'fast' | 'hint' | 'streak' | 'lostPiece';
export const voiceLines = (moment: VoiceMoment) => i18n.t(`voice:${moment}`, { returnObjects: true }) as string[];

/** Clean solves in a row this session (the solver remounts per puzzle, so the count lives here). */
let cleanStreak = 0;
const FAST_SOLVE = 12; // seconds
const STREAK = 3;

/** Which quip a finished puzzle earns: mate first, then a streak, a fast solve, a capture, plain praise.
 *  A missed puzzle earns none (the coach's kinder "missed" lines are used instead). */
export function cleanMoment({ clean, mate, captured, seconds, streak }: {
  clean: boolean; mate: boolean; captured: boolean; seconds: number; streak: number;
}): VoiceMoment | null {
  if (!clean) return null;
  if (mate) return 'mate';
  if (streak > 0 && streak % STREAK === 0) return 'streak';
  if (seconds < FAST_SOLVE) return 'fast';
  return captured ? 'capture' : 'great';
}

/** In a run the solver reports each puzzle to the run instead of the rated attempt endpoint. */
interface RunHooks { onSolve: () => void; onFail: (tried: string, answer: string) => void }

function Solver({ puzzle, theme, onNext, onResult, run }: {
  puzzle: Puzzle; theme: string; onNext: () => void; onResult: (attempt: PuzzleAttempt) => void; run?: RunHooks;
}) {
  const { t } = useTranslation('puzzles');
  const blindfold = puzzleBlindfold.use();
  const coachLines = (key: 'missed') => t(`coach.${key}`, { returnObjects: true }) as string[];
  const toast = useToast();
  const [result, setResult] = useState<PuzzleAttempt | null>(null);
  const sounds = useSounds();
  const coach = useNarration();
  const solve = usePuzzleSolver(puzzle, {
    onSolve: run ? run.onSolve : attempt => void report(attempt),
    onMiss: run?.onFail,
    endOnMiss: !!run,
  });
  const { line, played, misses, wrong, alsoGood, hinted, revealed, showHint, showMove, busy, finished, board, current, planning, solver, solverTurn, expected, clean } = solve;
  const hard = hardMode.use();
  const hintOnly = puzzleHelp.use() === 'hint';
  const ratings = showRatings.use();
  const autoNext = puzzleAutoNext.use();
  // Once the puzzle is over, the solution can be stepped through: `step` plies of the line are on
  // the board (1 is the puzzle's start, after the opponent's setup move); null is the board as played.
  const [step, setStep] = useState<number | null>(null);
  const stepped = usePosition(puzzle.fen, line.slice(0, step ?? 0), step !== null);

  // Every move that lands knocks; a correct move mid-puzzle chimes too, and a check gets a word.
  const landed = useRef(0);
  const onLanded = useEffectEvent(() => {
    sounds.move(played.at(-1)?.san);
    const mine = played.length > 1 && played.length % 2 === 0;
    if (mine && played.length < line.length) {
      sounds.correct();
      if (played.at(-1)?.san.includes('+')) coach.speak({ narration: lineFor(voiceLines('check'), `${puzzle.id}${played.length}`) });
    }
  });
  useEffect(() => {
    if (played.length > landed.current) onLanded();
    landed.current = played.length;
  }, [played.length]);

  // A wrong try buzzes and gets a gentle roast from the coach.
  const onMiss = useEffectEvent(() => {
    sounds.wrong();
    if (!run) coach.speak({ narration: lineFor(voiceLines('wrong'), `${puzzle.id}${misses.length}`) });
  });
  useEffect(() => {
    if (misses.length) onMiss();
  }, [misses.length]);

  async function report({ misses: wrongMoves, hinted: hint, revealed: shown, seconds }: PuzzleSolve) {
    try {
      const attempt = await api<PuzzleAttempt>('api/puzzles/attempt', { id: puzzle.id, misses: wrongMoves, hint, revealed: shown, seconds });
      setResult(attempt);
      onResult(attempt);
      for (const gain of attempt.improved ?? []) toast(gain.tier === 'unlocked' ? t('toasts.awardUnlocked', { title: gain.title }) : t('toasts.tierReached', { title: gain.title, tier: gain.tier }));
    } catch (e) { toast((e as Error).message); }
  }

  function retry() {
    solve.retry();
    setResult(null);
    setStep(null);
  }

  // Solved after a wrong move or a hint: the server's graded score still counts it (puzzles.SOLVED_MIN).
  const partial = !clean && result?.result === 'solved';

  // The end of the puzzle: a fanfare and praise for a clean solve, a kind word otherwise.
  const onFinished = useEffectEvent(() => {
    if (clean) sounds.complete();
    if (run) return; // a run moves straight on: no speech between puzzles
    cleanStreak = clean ? cleanStreak + 1 : 0;
    const moment = cleanMoment({
      clean, mate: puzzle.mate, captured: !!played.at(-1)?.san.includes('x'),
      seconds: solve.elapsed(), streak: cleanStreak,
    });
    coach.speak({ narration: lineFor(moment ? voiceLines(moment) : coachLines('missed'), puzzle.id) });
  });
  useEffect(() => {
    if (finished) onFinished();
  }, [finished]);
  // A clean solve moves on by itself when Settings asks, once the result is in and the praise has had a moment.
  const goNext = useEffectEvent(() => onNext());
  useEffect(() => {
    if (!autoNext || run || !finished || !clean || !result) return;
    const timer = setTimeout(() => goNext(), AUTO_NEXT_MS);
    return () => clearTimeout(timer);
  }, [autoNext, run, finished, clean, result]);
  const solverMoves = played.slice(1);
  const explore = explorePath({ fen: puzzle.fen, moves: played.map(m => m.uci), base: 1, from: puzzlePath(theme, puzzle.id), flipped: solver === 'black' });

  return (
    <div className="lesson-layout">
      <div className="lesson-board-column">
        <ChessBoard board={step !== null ? stepped.board : board} flipped={solver === 'black'} planning={planning}
          movable={!finished && solverTurn && current ? 'turn' : false} onMove={solve.onMove} busy={busy}
          lastMove={step !== null ? line[step - 1]?.uci ?? null : played.at(-1)?.uci ?? null}
          annotations={showHint && expected ? [{ from: expected.uci.slice(0, 2), to: expected.uci.slice(0, 2) }] : []}
          bestMove={showMove && expected ? expected.uci : null} hidePieces={blindfold} />
      </div>
      <div className="lesson-panel" aria-live="polite">
        <p className="lesson-prompt">
          <strong>{solver === 'white' ? t('solver.whiteToMove') : t('solver.blackToMove')}</strong>{' '}
          {played.length === 0 ? t('solver.watchOpponent') : finished ? '' : puzzleGoal(t, puzzle)}
        </p>
        <div className="lesson-actions">
          <button type="button" className="text-button" aria-pressed={blindfold} onClick={() => puzzleBlindfold.set(!blindfold)}>{blindfold ? t('blind.off') : t('blind.on')}</button>
        </div>
        {blindfold && (
          <div className="puzzle-info" id="puzzle-blindfold">
            <p>{t('blind.white', { pieces: piecesInWords(puzzle.fen, true, t('blind.letters')) })}</p>
            <p>{t('blind.black', { pieces: piecesInWords(puzzle.fen, false, t('blind.letters')) })}</p>
            <p>{t(solver === 'white' ? 'blind.blackPlayed' : 'blind.whitePlayed', { move: puzzle.setup.san })}</p>
          </div>
        )}
        {solverMoves.length > 0 && (
          <ol className="lesson-line" aria-label={t('solver.movesSoFar')}>
            {solverMoves.map((m, i) => <li key={i} className={i % 2 ? 'reply' : ''}>{moveLabel(fenAfterSetup(puzzle), i, m.san)}</li>)}
          </ol>
        )}

        {!finished && <>
          {wrong && <p className="lesson-verdict missed"><Trans t={t} i18nKey="solver.wrong" values={{ move: wrong }} components={{ strong: <strong /> }} /></p>}
          {alsoGood && <p className="lesson-verdict"><Trans t={t} i18nKey="solver.alsoGood" values={{ move: alsoGood }} components={{ strong: <strong /> }} /></p>}
          {showHint && expected && <p className="lesson-hint with-mascot"><Mascot pose="idea" size={44} /><span><Trans t={t} i18nKey="solver.hint" components={{ strong: <strong /> }} /></span></p>}
          {showMove && expected && <p className="lesson-hint"><Trans t={t} i18nKey="solver.showMove" values={{ move: expected.san }} components={{ strong: <strong /> }} /></p>}
          {solverTurn && !run && !hard && (
            <div className="lesson-actions">
              {!showHint && <button type="button" className="text-button icon-text" onClick={() => { solve.hint(); coach.speak({ narration: lineFor(voiceLines('hint'), puzzle.id) }); }}><img src={brandIcon('hint')} alt="" width="14" height="14" />{t('solver.hintButton')}</button>}
              {!showMove && !hintOnly && <button type="button" className="text-button" onClick={solve.reveal}>{t('solver.showSolution')}</button>}
            </div>
          )}
          {/* The rook keeps the panel's empty room company while you think. */}
          <div className="panel-mascot">{wrong || showHint ? <Mascot pose={wrong ? 'confused' : 'pointer'} size={150} /> : <CursorRook size={150} />}</div>
        </>}

        {finished && !run && <>
          <div className={`lesson-verdict ${clean || partial ? 'correct' : 'missed'}`} id="puzzle-result">
            <Mascot pose={clean ? 'check' : misses.length >= 3 ? 'dizzy' : 'thinking'} size={64} className="verdict-mascot" />
            <strong>{clean ? t('solver.solved') : partial ? t('solver.partial') : t('solver.missed')}</strong>{' '}
            {clean ? (puzzle.mate ? t('solver.checkmate') : t('solver.wholeLine')) : missText(t, misses, hinted, revealed, partial)}
            {result?.score != null && <p className="puzzle-rating-change puzzle-score">{scoreText(t, result)}</p>}
            {result && ratings && (
              <p className="puzzle-rating-change">
                {result.rated
                  ? <Trans t={t} i18nKey="solver.rating" values={{ rating: result.rating, delta: `${result.delta > 0 ? '+' : ''}${result.delta}` }}
                    components={{ strong: <strong />, delta: <span className={`puzzle-delta${result.delta > 0 ? ' up' : result.delta < 0 ? ' down' : ''}`} /> }} />
                  : t('solver.notRated')}
              </p>
            )}
          </div>
          <p className="puzzle-info">
            {t('solver.puzzleRating', { rating: puzzle.rating })}
            {puzzle.themes.length > 0 && <> · {puzzle.themes.map((th, i) => <span key={th.slug}>{i > 0 && ', '}<Link to={puzzlePath(th.slug)}>{th.title}</Link></span>)}</>}
          </p>
          <div className="puzzle-solution">
            <strong>{t('solver.solution')}</strong>
            <ol className="lesson-line" aria-label={t('solver.solution')}>
              {line.slice(1).map((m, i) => (
                <li key={i} className={i % 2 ? 'reply' : ''}>
                  <button type="button" className="text-button" aria-current={step === i + 2 ? 'step' : undefined}
                    onClick={() => setStep(i + 2)}>{moveLabel(fenAfterSetup(puzzle), i, m.san)}</button>
                </li>
              ))}
            </ol>
            <div className="lesson-actions">
              <button type="button" className="text-button" disabled={step === 1}
                onClick={() => setStep(s => Math.max(1, (s ?? line.length) - 1))}>◀ {t('solver.stepBack')}</button>
              <button type="button" className="text-button" disabled={step === line.length}
                onClick={() => setStep(s => Math.min(line.length, (s ?? 0) + 1))}>{t('solver.stepForward')} ▶</button>
              {step !== null && <button type="button" className="text-button" onClick={() => setStep(null)}>{t('solver.asPlayed')}</button>}
            </div>
          </div>
          <div className="lesson-actions">
            <button type="button" className="button primary" onClick={onNext}>{t('solver.nextPuzzle')}</button>
            <button type="button" className="text-button" onClick={retry}>{t('solver.tryAgain')}</button>
            <Link className="text-button" to={explore}>{t('solver.analyze')}</Link>
            {puzzle.game && <a className="text-button" href={puzzle.game} target="_blank" rel="noreferrer">{puzzle.game.includes('lichess.org') ? t('solver.lichess') : t('solver.originalGame')}</a>}
          </div>
        </>}
      </div>
    </div>
  );
}

/** The FEN the solver starts from, for move numbers. */
function fenAfterSetup(puzzle: Puzzle) {
  const [placement, turn, castling, ep, half, full] = puzzle.fen.split(' ');
  return [placement, turn === 'w' ? 'b' : 'w', castling, ep, half, turn === 'b' ? String(Number(full) + 1) : full].join(' ');
}

/** What the solver is after, said up front: mate in so many moves, a lasting advantage, or saving the game. */
export function puzzleGoal(t: TFunction<'puzzles'>, puzzle: Puzzle) {
  if (puzzle.mate) return t('solver.goalMate', { count: Math.ceil(puzzle.moves.length / 2) });
  if (puzzle.themes.some(theme => theme.slug === 'equality')) return t('solver.goalHold');
  return t('solver.goalWin');
}

function missText(t: TFunction<'puzzles'>, misses: string[], hinted: boolean, revealed: boolean, partial = false) {
  const parts = [];
  if (misses.length) parts.push(t('missText.triedFirst', { moves: misses.join(', ') }));
  if (revealed) parts.push(t('missText.lookedAtSolution'));
  else if (hinted) parts.push(t('missText.usedHint'));
  parts.push(partial ? t('missText.partialCredit') : t('missText.inList'));
  return parts.join(' ');
}

/** "Score 112% · 4s · speed bonus +12%": the graded score behind the rating change. */
export function scoreText(t: TFunction<'puzzles'>, result: PuzzleAttempt) {
  const parts = [t('score.score', { percent: Math.round((result.score ?? 0) * 100) })];
  if (result.seconds != null) parts.push(t('attempt.seconds', { seconds: result.seconds }));
  if (result.time_bonus) parts.push(t('score.speedBonus', { percent: Math.round(result.time_bonus * 100) }));
  return parts.join(' · ');
}
