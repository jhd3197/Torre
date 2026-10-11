// /games/:id/:ply — replay a saved (or imported) game with automatic engine analysis.
import { PhaseTable } from '../components/BotReport';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BoardWorkspace } from '../components/BoardWorkspace';
import { MoreMenu, TopbarSlot } from '../components/TopbarSlot';
import { GameLibrary } from '../components/GameLibrary';
import { AnalysisBanner } from '../components/AnalysisBanner';
import { GameReview } from '../components/CoachExplain';
import { GameRecap, recapKey, recapWillPlay } from '../components/GameRecap';
import { GradeTable } from '../components/GradeTable';
import { EvalGraph, type EvalMark, type EvalPoint } from '../components/EvalGraph';
import { AccuracyCards, GradeChips, ResultBanner, WorthALook, type Moment } from '../components/ReviewSummary';
import { Mascot } from '../components/Reward';
import { cachedBoard, isReviewed, reviewedEvals, reviewedResult, reviewPlies } from '../hooks/useChess';
import { sideToMove, startPly } from '../lib/format';
import { longThink, recapLines, swingOf, thinkTimes as clockTimes, type Outcome } from '../lib/commentary';
import { emptyGrades, GRADE_INFO, gradeLine, gradeOf, type Grade } from '../lib/grades';
import { analysisEngine, autoAnalysis as autoAnalysisSetting } from '../lib/settings';
import { api } from '../lib/api';
import { explorePath, gamePath, mistakesPath } from '../lib/routes';
import { useGameData, useToast } from '../state/AppData';
import { lastVisited } from '../state/lastVisited';
import { usePhone } from '../hooks/usePhone';
import { useShare } from '../hooks/useShare';
import { ShareButton, ShareIcon } from '../components/ShareButton';
import { celebrated, MoveCelebration } from '../components/workspace/MoveCelebration';
import type { AnalyzedMove, Color, GameDetail } from '../types';

const SCORING_VERSION = 3;
const gameCache = new Map<string, GameDetail>();

function useGame(id: string) {
  const [state, setState] = useState<{ id: string; game: GameDetail | null; error: string | null }>(() => ({
    id, game: gameCache.get(id) ?? null, error: null,
  }));
  useEffect(() => {
    const cached = gameCache.get(id);
    if (cached) { setState({ id, game: cached, error: null }); return; }
    setState({ id, game: null, error: null });
    const controller = new AbortController();
    api<GameDetail>(`api/games/${encodeURIComponent(id)}`, undefined, controller.signal)
      .then(game => { gameCache.set(id, game); setState({ id, game, error: null }); })
      .catch(error => { if (!controller.signal.aborted) setState({ id, game: null, error: (error as Error).message }); });
    return () => controller.abort();
  }, [id]);
  return state.id === id ? state : { id, game: null, error: null };
}

const REVIEW_BATCH = 6; // plies per request: one engine start, ~1 s of searching

/**
 * Chess.com-style review: on opening a game, Stockfish analyzes every position in the background
 * while the panel shows a simple loading section; the verdicts, moves and summary appear once it is
 * done. Everything is cached, so stepping around afterwards is instant.
 */
function useReview(id: string, game: GameDetail | null) {
  const { t } = useTranslation('games');
  const { engineAvailable } = useGameData();
  const toast = useToast();
  const autoAnalysis = autoAnalysisSetting.use();
  const [reviewing, setReviewing] = useState<string | null>(null); // the game under review
  const [saved, setSaved] = useState(0); // bumps when a review lands, so grades refresh
  const [done, setDone] = useState(0); // positions reviewed so far, for the loading bar
  const live = useRef({ toast, t, stop: () => {} });
  live.current = { ...live.current, toast, t };

  useEffect(() => {
    if (!game || !engineAvailable || !autoAnalysis) return;
    const { initialFen, moves } = game, total = moves.length, engineId = analysisEngine.get();
    if (isReviewed(initialFen, moves, 0, total, engineId)) return;
    const controller = new AbortController();
    const finish = () => { controller.abort(); setReviewing(null); setSaved(n => n + 1); };
    live.current.stop = finish;
    setReviewing(id);
    setDone(0);
    (async () => {
      // A game reviewed before comes back from the server at once.
      await reviewPlies(initialFen, moves, 0, total, controller.signal, true, engineId).catch(() => {});
      for (let from = 0; from <= total && !controller.signal.aborted; from += REVIEW_BATCH) {
        const to = Math.min(total, from + REVIEW_BATCH - 1);
        if (!isReviewed(initialFen, moves, from, to, engineId)) await reviewPlies(initialFen, moves, from, to, controller.signal, false, engineId);
        if (!controller.signal.aborted) setDone(to);
      }
    })().then(() => { if (!controller.signal.aborted) finish(); }, error => {
      if (controller.signal.aborted) return;
      live.current.toast(live.current.t('errors.reviewFailed', { error: (error as Error).message }));
      finish();
    });
    return () => { controller.abort(); setReviewing(null); };
  }, [id, game, engineAvailable, autoAnalysis]);

  return { reviewing: reviewing === id, saved, done, skip: () => live.current.stop() };
}

/** /games — the saved games, each opening its review. */
export function GamesIndex() {
  const { t } = useTranslation('games');
  const { games, gamesLoaded } = useGameData();
  if (!gamesLoaded) return <p className="page-status" role="status">{t('index.loading')}</p>;
  if (games.length) return <GameLibrary />;
  return (
    <div className="page-empty">
      <h2>{t('index.emptyTitle')}</h2>
      <p>{t('index.emptyBody')}</p>
      <Link className="button primary" to="/play/bots">{t('index.play')}</Link>
    </div>
  );
}

/** "600+5" as "10+5"; anything else as it came. */
function timeControl(value: string | undefined) {
  const match = value?.match(/^(\d+)(?:\+(\d+))?$/);
  if (!match) return value && value !== '-' && value !== '?' ? value : null;
  const base = Number(match[1]);
  return `${base % 60 ? (base / 60).toFixed(1) : base / 60}+${match[2] ?? 0}`;
}

export function GamePage() {
  const { t } = useTranslation('games');
  const { id = '', ply } = useParams();
  // Rooky's recap plays on its own only for a game opened as a whole, not a link to one of its moves.
  const opened = useRef({ id, whole: ply === undefined });
  if (opened.current.id !== id) opened.current = { id, whole: ply === undefined };
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { game, error } = useGame(id);
  const [flipped, setFlipped] = useState<boolean | null>(null);
  const phone = usePhone();

  useEffect(() => { lastVisited.games = location.pathname; }, [location.pathname]);
  useEffect(() => setFlipped(null), [id]);

  const total = game?.moves.length ?? 0;
  const requested = ply === undefined ? 0 : Number(ply);
  const cursor = Number.isFinite(requested) ? Math.max(0, Math.min(total, requested)) : 0;
  const show = useCallback((next: number) => navigate(gamePath(id, Math.max(0, Math.min(total, next))), { replace: true }), [navigate, id, total]);
  const { reviewing, saved, done, skip } = useReview(id, game);
  const go = show;

  const analysis = game?.analysis?.scoring_version === SCORING_VERSION ? game.analysis : null;
  // The in-page review's evaluations: they grade a game with no saved analysis, and draw the graph.
  const evals = useMemo(() => (game ? reviewedEvals(game.initialFen, game.moves, analysisEngine.get()) : []),
    [game, reviewing, saved, cursor]); // eslint-disable-line react-hooks/exhaustive-deps -- the cache fills as the review runs
  // Every move is graded, both sides', so the verdict is there on each step; the summary keeps them apart.
  const judgments = useMemo(() => {
    if (!game) return new Map<number, AnalyzedMove>();
    const grades = analysis?.move_grades;
    if (grades?.length === game.moves.length) {
      return new Map<number, AnalyzedMove>(grades.map((grade, i) => [i + 1, { ...grade, ply: i + 1, san: game.moves[i].san }]));
    }
    if (analysis) return new Map<number, AnalyzedMove>((analysis.moves ?? []).map(m => [m.ply, m]));
    return gradeLine(game.moves, evals, sideToMove(game.initialFen) === 'white');
  }, [analysis, game, evals]);
  const bestMoves = analysis?.best_moves ?? evals.map(e => e?.best ?? null);
  const thinkTimes = useMemo(() => (game ? clockTimes(game.moves, game.headers.TimeControl) : undefined), [game]);
  const opening = useMemo(() => (game?.opening ? { ply: game.opening.ply, name: game.opening.name } : null), [game]);
  const gameId = String(game?.record?.id ?? id);
  const copyPgn = useCallback(async () => {
    try {
      const response = await fetch(`api/games/${encodeURIComponent(gameId)}/pgn`);
      if (!response.ok) throw new Error(response.statusText);
      await navigator.clipboard.writeText(await response.text());
      toast(t('game.pgnCopied'));
    } catch { toast(t('game.pgnCopyFailed')); }
  }, [gameId, toast, t]);
  // On torre.sh a share is a public link to the game or a move; on your own computer, the PGN copied.
  const sharer = useShare(copyPgn);
  // The brilliant and great moves already celebrated this visit, as "<game>:<ply>".
  const [seen] = useState(() => new Set<string>());

  if (error) return <div className="page-empty"><h2>{t('game.unavailable')}</h2><p>{error}</p><Link className="button" to="/games">{t('game.openGames')}</Link></div>;
  if (!game) return <p className="page-status" role="status">{t('game.loading')}</p>;

  const record = game.record;
  const userColor: Color = record?.user_color === 'black' ? 'black' : 'white';
  const isFlipped = flipped ?? userColor === 'black';
  const here = gamePath(id, cursor);
  const explore = (extra: string[] = []) => explorePath({
    fen: game.initialFen, moves: [...game.moves.slice(0, cursor).map(m => m.uci), ...extra], base: cursor, from: here, flipped: isFlipped,
  });
  const whiteName = game.headers.White || t('game.white'), blackName = game.headers.Black || t('game.black');
  const meta = [game.headers.Date, timeControl(game.headers.TimeControl), game.opening?.name, game.opening?.eco ?? game.headers.ECO]
    .filter(v => v && v !== '?' && v !== '????.??.??');
  // Your moves only when the game knows your side, like the accuracy beside it; both sides otherwise.
  const whiteFirst = sideToMove(game.initialFen) === 'white';
  const byWhite = (ply: number) => (ply % 2 === 1) === whiteFirst;
  const yours = (ply: number) => !record?.user_color || byWhite(ply) === (record.user_color === 'white');
  const tally = (mine: boolean) => [...judgments.values()].filter(m => yours(m.ply) === mine).reduce((c, m) => {
    c[gradeOf(m)]++;
    return c;
  }, emptyGrades());
  const counts = judgments.size ? tally(true) : undefined;
  const userName = (userColor === 'white' ? game.headers.White : game.headers.Black) || t(`game.${userColor}`);
  const oppColor: Color = userColor === 'white' ? 'black' : 'white';
  const oppName = (oppColor === 'white' ? game.headers.White : game.headers.Black) || t(`game.${oppColor}`);

  // The spoken recap: the result, the story of the evaluation, accuracy, the slips, your longest think.
  const result = record?.user_result ?? (game.headers.Result === '1/2-1/2' ? 0.5
    : game.headers.Result === '1-0' ? (userColor === 'white' ? 1 : 0) : game.headers.Result === '0-1' ? (userColor === 'black' ? 1 : 0) : null);
  const outcome: Outcome | null = result === 1 ? 'won' : result === 0 ? 'lost' : result === 0.5 ? 'drew' : null;
  let longestThink: { seconds: number; move: number; good: boolean } | null = null;
  thinkTimes?.forEach((seconds, i) => {
    if (seconds == null || !yours(i + 1) || (longestThink && longestThink.seconds >= seconds)) return;
    const grade = judgments.get(i + 1);
    longestThink = { seconds, move: Math.floor((startPly(game.initialFen) + i) / 2) + 1,
      good: !grade || !['mistake', 'blunder'].includes(gradeOf(grade)) };
  });
  const recap = reviewing || !counts ? [] : recapLines({
    outcome, counts, longestThink, longThink: longThink(game.headers.TimeControl),
    swing: outcome && record?.user_color ? swingOf(analysis?.evals ?? evals, userColor, outcome, game.initialFen) : null,
    accuracy: analysis?.accuracy ?? record?.user_accuracy ?? null,
  });

  // The evaluation graph: the saved analysis's scores, or the in-page review's as it fills in.
  const points: EvalPoint[] = analysis?.evals?.length === total + 1
    ? analysis.evals.map(([cp, mate]) => (cp == null && mate == null ? null : { cp, mate }))
    : evals.map(e => (e ? { cp: e.cp, mate: e.mate } : null));
  const marks: EvalMark[] = [...judgments.values()].map(m => ({ ply: m.ply, grade: gradeOf(m), white: byWhite(m.ply), yours: yours(m.ply) }));

  // Worth another look: the saved key moments, or your slips from the review, each opening the position before.
  const moveNumber = (ply: number) => Math.floor((startPly(game.initialFen) + ply - 1) / 2) + 1;
  const betterSan = (ply: number) => {
    const best = bestMoves[ply - 1], line = reviewedResult(game.initialFen, game.moves, ply - 1, analysisEngine.get())?.lines.find(l => l.uci[0] === best);
    return best && best !== game.moves[ply - 1]?.uci ? line?.moves[0] ?? null : null;
  };
  const moments: Moment[] = analysis?.key_moments?.length
    ? analysis.key_moments.map(moment => {
      const grade = (moment.brilliant ? 'brilliant' : moment.class ?? 'good') as Grade;
      const swing = moment.win_before != null && moment.win_after != null
        ? t('game.keyMomentSwing', { before: Math.round(moment.win_before), after: Math.round(moment.win_after) }) : '';
      return { ply: moment.ply, target: moment.ply - 1, grade, title: t('game.keyMomentMove', { move: moment.move_number, san: moment.san }),
        detail: [t(`game.gradeTable.${grade}`), swing].filter(Boolean).join(' · ') };
    })
    : [...judgments.values()].filter(m => yours(m.ply) && ['inaccuracy', 'mistake', 'blunder'].includes(gradeOf(m))).slice(0, 6).map(m => {
      const grade = gradeOf(m), better = betterSan(m.ply);
      return { ply: m.ply, target: m.ply - 1, grade, title: t('game.keyMomentMove', { move: moveNumber(m.ply), san: m.san }),
        detail: [t(`game.gradeTable.${grade}`), better && t('summary.betterWas', { san: better })].filter(Boolean).join(' · ') };
    });

  const finalBoard = cachedBoard(game.initialFen, game.moves, total);
  const ending = game.headers.Termination || (finalBoard?.result ? finalBoard.termination : '') || t('summary.moves', { count: moveNumber(total) });
  const winner = game.headers.Result === '1-0' ? whiteName : game.headers.Result === '0-1' ? blackName : null;

  const title = record?.user_color ? t('game.youVs', { name: oppName }) : t('game.versus', { white: whiteName, black: blackName });
  // The current move as the share sheet names it: "23. Nxe5 (Brilliant) in You vs Duke-BOT".
  const shareMove = (ply: number) => () => {
    const judged = judgments.get(ply), san = game.moves[ply - 1]?.san ?? '';
    const move = `${moveNumber(ply)}${byWhite(ply) ? '.' : '…'} ${san}`;
    return { game: gameId, ply, title,
      text: judged ? t('common:share.moveText', { move, grade: GRADE_INFO[gradeOf(judged)].label, game: title }) : t('common:share.plainMoveText', { move, game: title }) };
  };
  const shareGameRequest = () => ({ game: gameId, ply: null, title, text: title });
  // A brilliant or great move of yours, once the review has graded it, gets its celebration.
  const nowJudged = !reviewing && cursor > 0 ? judgments.get(cursor) : undefined;
  const nowGrade = nowJudged ? gradeOf(nowJudged) : null;
  const celebration = celebrated(nowGrade) && yours(cursor) ? (
    <MoveCelebration key={`${gameId}:${cursor}`} moveKey={`${gameId}:${cursor}`} grade={nowGrade} seen={seen}
      sharer={record ? sharer : undefined} request={shareMove(cursor)} />
  ) : undefined;
  const more = (
    <MoreMenu label={t('game.more')}>
      <Link role="menuitem" id="explore-position" to={explore()}>{t('game.explorePosition')}</Link>
      {record && analysis && counts && counts.mistake + counts.blunder > 0 && (
        <Link role="menuitem" id="learn-mistakes" to={mistakesPath(record.id)} title={t('trainer:entry.buttonTitle')}>{t('trainer:entry.button')}</Link>
      )}
      {record && phone && sharer.hosted && <button type="button" role="menuitem" disabled={sharer.busy} onClick={() => void sharer.share(shareGameRequest())}>{t('common:share.game')}</button>}
      {record && phone && <button type="button" role="menuitem" onClick={() => void copyPgn()}>{t('game.copyPgn')}</button>}
      {record && (
        <a role="menuitem" id="export-pgn" download href={`api/games/${encodeURIComponent(String(record.id))}/pgn`}
          title={analysis ? t('game.exportTitleAnalyzed') : t('game.exportTitlePlain')}>{t('game.exportPgn')}</a>
      )}
      {record && (
        <a role="menuitem" download href={`api/games/${encodeURIComponent(String(record.id))}/export`}
          title={t('game.exportTorreTitle')}>{t('game.exportTorre')}</a>
      )}
    </MoreMenu>
  );

  return (
    <>
      {/* The top bar carries this page's controls: back to the games, flip, copy, and the rest under More. */}
      <TopbarSlot slot="lead"><Link className="board-back" id="all-games" to="/games">‹ {t('game.allGames')}</Link></TopbarSlot>
      <TopbarSlot slot="tools">
        <button className="icon-button" id="flip" type="button" title={t('board:workspace.flipTitle')} aria-label={t('board:workspace.flip')}
          onClick={() => setFlipped(!isFlipped)}>⇅</button>
        {record && (sharer.hosted
          ? <ShareButton sharer={sharer} id="share-game" request={shareGameRequest} title={t('common:share.gameTitle')}>{t('common:share.game')}</ShareButton>
          : <button className="button" id="copy-pgn" type="button" onClick={() => void copyPgn()}>{t('game.copyPgn')}</button>)}
        {more}
      </TopbarSlot>
      {!phone && <header className="review-head">
        <h1>{title}</h1>
        {meta.length > 0 && <p id="session-subtitle">{meta.join(' · ')}</p>}
      </header>}
      <BoardWorkspace mode="replay" initialFen={game.initialFen} moves={game.moves} cursor={cursor} onGo={go}
        phoneHead={{ title, sub: meta.join(' · ') || undefined, back: '/games', tools: more }}
        loading={reviewing ? (
          <div className="review-loading" role="status" aria-label={t('game.reviewing')}>
            <Mascot pose="magnify" size={140} />
            <strong>{t('game.reviewing')}</strong>
            <span>{t('game.reviewingDetail', { count: total })}</span>
            <div className="review-progress">
              <div role="progressbar" aria-label={t('game.reviewProgress')} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
                <i style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
              </div>
              <span>{t('game.reviewCount', { done, total })}</span>
            </div>
            <button type="button" className="text-button" onClick={skip}>{t('game.skip')}</button>
          </div>
        ) : undefined}
        flipped={isFlipped} onFlip={() => setFlipped(!isFlipped)}
        players={{
          white: { name: whiteName, detail: [game.headers.WhiteElo, t('game.whitePieces')].filter(Boolean).join(' · ') },
          black: { name: blackName, detail: [game.headers.BlackElo, t('game.blackPieces')].filter(Boolean).join(' · ') },
        }}
        movable="turn" onMove={uci => navigate(explore([uci]))}
        verdictNote={celebration}
        verdictAction={record && sharer.hosted && cursor > 0 && !celebration ? (
          <ShareButton sharer={sharer} className="icon-button verdict-share" id="share-move" request={shareMove(cursor)}
            title={t('common:share.moveTitle')} label={t('common:share.move')}><ShareIcon /></ShareButton>
        ) : undefined}
        resultText={game.headers.Result} judgments={judgments} bestMoves={bestMoves} autoplay opening={opening} thinkTimes={thinkTimes} you={record?.user_color ? userColor : undefined}
        longThink={longThink(game.headers.TimeControl)} startClock={Number(game.headers.TimeControl?.split('+')[0]) || null}
        onTryBest={uci => navigate(explore([uci]))} tryLabel={t('game.exploreBest')}
        heading={false} startTab={opened.current.whole ? 'summary' : 'moves'}
        showSummary={opened.current.whole && record && recap.length && recapWillPlay(record.id) ? recapKey(record.id) : null}
        movesTop={!reviewing && <EvalGraph points={points} marks={marks} cursor={cursor} initialFen={game.initialFen} sans={game.moves.map(m => m.san)} onGo={go} />}
        summary={<>
          {game.headers.Result && <ResultBanner outcome={record?.user_color ? outcome : null} result={game.headers.Result} winner={winner} ending={ending} />}
          {!reviewing && (
            <AccuracyCards cards={record?.user_color ? [
              { name: t('summary.you'), accuracy: analysis?.accuracy ?? record.user_accuracy ?? null, you: true },
              { name: oppName, accuracy: analysis?.opp_accuracy ?? null, you: false },
            ] : []} />
          )}
          {counts && !reviewing && <GradeChips counts={counts} title={record?.user_color ? t('summary.yourMoves') : t('summary.allMoves')} />}
          {!reviewing && <WorthALook moments={moments} cursor={cursor} onGo={go} note={t('game.keyMomentsNote')} />}
          <GameRecap gameId={record?.id ?? null} recap={recap} analyzed={!!(record && analysis)} autoplay={opened.current.whole}
            pose={outcome === 'won' ? 'trophy' : outcome === 'lost' ? 'hug' : outcome === 'drew' ? 'nod' : 'notes'} />
          {record && analysis && <GameReview id={record.id} />}
          {game.opening && (
            <div className="game-opening summary-block">
              <h3>{t('game.openingPlayed')}</h3>
              <p>{game.opening.name} · {game.opening.eco}</p>
              {game.opening.transposed && <p>{t('game.openingTransposed')}</p>}
              <details>
                <summary>{t('game.openingMoves')}</summary>
                <p>{game.opening.line}</p>
              </details>
              <button type="button" className="text-button" onClick={() => go(game.opening!.ply)}>
                {t('game.openingPosition')}
              </button>
            </div>
          )}
          {!reviewing && game.phases && record?.user_color && (
            <div className="game-phases summary-block"><h3>{t('game.byPhase')}</h3><PhaseTable phases={game.phases} other={oppName} /></div>
          )}
          {counts && !reviewing && record?.user_color && (
            <details className="summary-block grade-compare">
              <summary>{t('summary.compare', { name: oppName })}</summary>
              <GradeTable columns={[
                { name: userName, accuracy: analysis?.accuracy ?? record.user_accuracy ?? null, counts },
                { name: oppName, accuracy: analysis?.opp_accuracy ?? null, counts: tally(false) },
              ]} />
            </details>
          )}
          {record && !analysis && <AnalysisBanner />}
        </>} />
    </>
  );
}
