// The board screen shared by Games (replay), Explore and Play.
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChessBoard } from './ChessBoard';
import { EnginePanel } from './workspace/EnginePanel';
import { EvalBar } from './workspace/EvalBar';
import { MoveList, moveProgress } from './workspace/MoveList';
import { EmptyVerdict, MoveVerdict } from './workspace/MoveVerdict';
import { CursorRook } from './CursorRook';
import { Segments } from './Segments';
import { HeatLegend, Playback, PlanningToolbar, PlayerStrip, type PlayerInfo } from './workspace/Parts';
import { useEngine, usePosition } from '../hooks/useChess';
import { usePlanning } from '../hooks/usePlanning';
import { analysisDepth, analysisEngine, autoAnalysis as autoAnalysisSetting, bestArrow, evalBar as evalBarSetting, nextArrow, squareControl } from '../lib/settings';
import { useReviewVoice } from '../hooks/useReviewVoice';
import { useSounds } from '../hooks/useSounds';
import { heat, pieceNames } from '../lib/boardTools';
import { scoreLabel } from '../lib/format';
import { gradeOf } from '../lib/grades';
import { useGameData, useToast } from '../state/AppData';
import type { AnalyzedMove, BoardState, Color, LessonMark, Move } from '../types';

export type WorkspaceMode = 'replay' | 'explore' | 'play';
type PanelTab = 'moves' | 'engine' | 'summary';

export interface BoardWorkspaceProps {
  mode: WorkspaceMode;
  initialFen: string;
  moves: Move[];
  cursor: number;
  onGo: (ply: number) => void;
  flipped: boolean;
  onFlip: () => void;
  players: Record<Color, PlayerInfo>;
  movable: Color | 'turn' | false;
  onMove?: (uci: string) => void | Promise<void>;
  busy?: boolean;
  busyText?: string;
  /** Links above the board (Explore position, Export PGN). */
  headerActions?: ReactNode;
  /** The row above the board (actions and flip); a page that puts them in the top bar turns it off. */
  heading?: boolean;
  /** Banner under the header (Explore's "Back to game"). */
  context?: ReactNode;
  panelTop?: ReactNode;
  panelBottom?: ReactNode;
  /** The game as a whole (opening, grades, recap): its own Summary tab beside the moves and the engine. */
  summary?: ReactNode;
  /** Open the Summary tab once for each new key (the game page does when Rooky starts its recap). */
  showSummary?: string | null;
  /** The tab a review opens on: the summary for a game opened as a whole, the moves for a link to one. */
  startTab?: 'summary' | 'moves';
  /** Under the review's verdict, above the moves (the game page's evaluation graph). */
  movesTop?: ReactNode;
  /** Your side in a replay: the verdict labels your moves "You" and the other side's "Played". */
  you?: Color;
  /** While set (the opening review running), the panel shows this in place of the verdict, moves and the rest. */
  loading?: ReactNode;
  boardFooter?: ReactNode;
  judgments?: Map<number, AnalyzedMove>;
  /** Stockfish's choice before each move, by ply index, for the review verdict. */
  bestMoves?: (string | null)[];
  /** Final result to show when the board itself is not over (a resigned replay). */
  resultText?: string;
  /** Explore the engine's best move from here. */
  onTryBest?: (uci: string) => void;
  tryLabel?: string;
  autoplay?: boolean;
  /** Called with the current board whenever it changes. */
  onBoard?: (board: BoardState) => void;
  /** The opening the game reaches, named aloud on its move by the review voice. */
  opening?: { ply: number; name: string } | null;
  /** Seconds each move took (by move index), when the game recorded clocks, and what counts as a long think. */
  thinkTimes?: (number | null)[];
  longThink?: number;
  /** Each side's starting clock in seconds, for the low-clock moments. */
  startClock?: number | null;
  /** What the coach points at while you play: a circled piece, the move it suggests, a threat. */
  coachMarks?: { highlight?: string[]; arrow?: string | null; annotations?: LessonMark[] };
  /** Blindfold: the board shows the squares only. */
  hidePieces?: boolean;
}

/** SAN of the engine's best move, from the first line that starts with it. */
function sanOf(result: { lines: { uci: string[]; moves: string[] }[] } | null, uci: string): string | null {
  const line = result?.lines.find(l => l.uci[0] === uci);
  return line?.moves[0] ?? null;
}

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
/** White's material minus Black's, in pawns, from a FEN's placement. */
function materialOf(fen: string): number {
  let sum = 0;
  for (const c of fen.split(' ')[0]) {
    const value = VALUES[c.toLowerCase()];
    if (value) sum += c === c.toLowerCase() ? -value : value;
  }
  return sum;
}

export function BoardWorkspace(props: BoardWorkspaceProps) {
  const { mode, initialFen, moves, cursor, onGo, flipped, onFlip, players, movable, onMove, busy = false, busyText,
    headerActions, heading = true, context, panelTop, panelBottom, summary, showSummary, startTab, movesTop, boardFooter, judgments, bestMoves, resultText, onTryBest, tryLabel: tryLabelProp,
    autoplay = false, onBoard, opening, thinkTimes, longThink, startClock, loading, you, coachMarks, hidePieces } = props;
  const { t } = useTranslation('board');
  const tryLabel = tryLabelProp ?? t('engine.tryMove');
  const { engineAvailable, engines } = useGameData();
  const toast = useToast();
  const shown = moves.slice(0, cursor);
  const { board, current } = usePosition(initialFen, shown);
  // Hovering one of the verdict's moves shows the position before the move, that move drawn on it.
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => setPreview(null), [cursor]);
  const before = usePosition(initialFen, moves.slice(0, Math.max(0, cursor - 1)), mode === 'replay' && cursor > 0);
  const previewing = preview && before.current ? before.board : null;
  const planning = usePlanning(board);
  const analysisMode = mode !== 'play';
  const autoAnalysis = autoAnalysisSetting.use();
  const showBest = bestArrow.use();
  const showHeat = squareControl.use();
  const showNext = nextArrow.use();
  const showEvalBar = evalBarSetting.use();
  const depth = analysisDepth.use();
  const finished = !!board?.result;
  // The analysis engine, chosen in the panel; an uninstalled choice falls back to Stockfish.
  const installedEngines = engines.filter(engine => engine.installed);
  const chosenEngine = analysisEngine.use();
  const engineId = engines.length && !installedEngines.some(engine => engine.id === chosenEngine) ? 'stockfish' : chosenEngine;
  const engine = useEngine(initialFen, shown, analysisMode && autoAnalysis && engineAvailable && !!board && !finished, 250, engineId, depth);
  const topLine = engine.result?.lines[0] ?? null;
  const [squareInfo, setSquareInfo] = useState<string | null>(null);
  // A review splits the panel into tabs; Explore keeps the engine beside its line, Play has no tabs.
  const [tab, setTab] = useState<PanelTab>(startTab ?? 'moves');
  const tabs: PanelTab[] = mode === 'replay' ? [...(summary ? ['summary' as const] : []), 'moves', 'engine'] : [];
  const tabbed = tabs.length > 1;
  const activeTab = tabs.includes(tab) ? tab : 'moves';
  const shownTab = (name: PanelTab) => !tabbed || activeTab === name;
  useEffect(() => { if (showSummary) setTab('summary'); }, [showSummary]);
  // Stepping to another move while the summary is up brings the moves forward, to see it reviewed.
  const tabCursor = useRef(cursor);
  useEffect(() => {
    if (tabCursor.current === cursor) return;
    tabCursor.current = cursor;
    setTab(current => (current === 'summary' ? 'moves' : current));
  }, [cursor]);
  const heatOn = mode === 'explore' && showHeat;

  useEffect(() => { if (board && current) onBoard?.(board); }, [board, current, onBoard]);
  useEffect(() => {
    document.body.dataset.mode = mode;
    document.body.dataset.page = 'board';
  }, [mode]);

  // A piece lands with a knock (a capture, check, castling or promotion with its own) whenever the
  // board moves forward one move: a move played, the bot's reply, a step or autoplay. Jumps, steps
  // back and the position a page opens on stay quiet.
  const sounds = useSounds();
  const lastCursor = useRef(cursor);
  const knock = useEffectEvent(() => { if (moves[cursor - 1]) sounds.move(moves[cursor - 1].san); });
  useEffect(() => {
    const was = lastCursor.current;
    lastCursor.current = cursor;
    if (cursor === was + 1) knock();
  }, [cursor]);

  // Stepping through a reviewed game, the coach says what each move was; playing it through, only the highlights.
  const [playing, setPlaying] = useState(false);
  const voice = useReviewVoice({
    brief: playing,
    enabled: mode === 'replay' && !busy && !loading, initialFen, moves, cursor, judgments, engineId, opening, thinkTimes, longThink, startClock, result: board?.result || resultText,
    before: cursor > 0 && before.current ? before.board : null, after: current ? board : null,
  });

  // Autoplay steps forward once a second until the end, letting the coach finish a sentence first.
  useEffect(() => { if (cursor >= moves.length) setPlaying(false); }, [cursor, moves.length]);
  useEffect(() => {
    if (!playing || voice.speaking) return;
    const timer = setTimeout(() => onGo(cursor + 1), 900);
    return () => clearTimeout(timer);
  }, [playing, cursor, onGo, voice.speaking]);

  // Stepping past either end nudges the board that way instead of doing nothing.
  const [bump, setBump] = useState<'back' | 'forward' | null>(null);
  useEffect(() => {
    if (!bump) return;
    const timer = setTimeout(() => setBump(null), 280);
    return () => clearTimeout(timer);
  }, [bump]);
  const step = (ply: number) => {
    if (ply < 0 || ply > moves.length) { setBump(ply < 0 ? 'back' : 'forward'); return; }
    onGo(ply);
  };

  // Keyboard: ←/→ step, F flips, Esc clears drawings.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target;
    if ((target instanceof Element && target.closest('input,textarea,select,dialog')) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') { planning.clear(); if (planning.drawMode) planning.toggleDrawMode(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); setPlaying(false); step(cursor - 1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); setPlaying(false); step(cursor + 1); }
    else if (event.key.toLowerCase() === 'f') onFlip();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  function describeSquare(square: string) {
    if (!heatOn || !board) return;
    const control = board.control?.[square], tint = heat(control);
    const names = (color: Color) => (control?.[color] ?? []).map(from => `${pieceNames[board.pieces[from]?.toLowerCase()] ?? t('heat.piece')} ${from}`).join(', ') || t('heat.none');
    setSquareInfo(t('heat.square', { square, kind: t(`heat.kind.${tint.kind}`), white: names('white'), black: names('black') }));
  }

  async function copyFen() {
    if (!board) return;
    try { await navigator.clipboard.writeText(board.fen); toast(t('copy.copied')); } catch { toast(t('copy.blocked')); }
  }

  const bottom: Color = flipped ? 'black' : 'white', top: Color = flipped ? 'white' : 'black';
  // A review counts the material on the board: the side ahead shows by how much, beside its name.
  const material = mode === 'replay' && board ? materialOf(board.fen) : null;
  const lead = (color: Color) => material == null ? undefined : (color === 'white' ? material : -material) > 0 ? `+${Math.abs(material)}` : null;
  // In a reviewed game, the move just played gets its grade on the board and a verdict in the panel.
  const judged = mode === 'replay' && cursor > 0 ? judgments?.get(cursor) : undefined;
  const gradeMark = judged && moves[cursor - 1] ? { square: moves[cursor - 1].uci.slice(2, 4), grade: gradeOf(judged) } : null;
  const status = busy ? (busyText ?? t('status.thinking'))
    : board?.result ? `${board.termination} · ${board.result}`
    : board ? `${t(`status.${board.turn}ToMove`)}${board.check ? ` · ${t('status.check')}` : ''}${mode === 'explore' ? ` · ${t('status.exploration')}` : ''}` : t('status.loading');
  const best = engine.result?.best ?? null;
  const bestShown = analysisMode && autoAnalysis && showBest && !finished ? best : null;
  // The move actually played from here: the game's next move, or the line's after stepping back.
  const next = analysisMode && cursor < moves.length ? moves[cursor] : null;
  const nextShown = showNext ? next?.uci ?? null : null;
  const nextLabel = mode === 'replay' ? t('arrows.playedInGame') : t('arrows.nextInLine');
  // Under the board in Play; in review and analysis it sits under the moves it steps through.
  const playback = (
    <Playback progress={moveProgress(initialFen, cursor, moves.length)} cursor={cursor} total={moves.length} disabled={busy}
      onGo={ply => { setPlaying(false); step(ply); }} fen={board?.fen} onCopy={copyFen}
      autoplay={playing} onAutoplay={autoplay ? () => { if (!playing && cursor >= moves.length) onGo(0); setPlaying(!playing); } : undefined} />
  );

  return (
    <section className="workspace" aria-label={t('workspace.label')}>
      <div className="board-column" data-bump={bump ?? undefined}>
        {heading && (
          <div className="board-heading">
            <div className="board-heading-actions">
              {headerActions}
              {mode === 'explore' && (
                <div id="explore-visuals"><button id="heat-toggle" type="button" aria-pressed={showHeat} onClick={() => squareControl.set(!showHeat)}>◉ {t('heat.toggle')}</button></div>
              )}
              <button className="icon-button" id="flip" type="button" title={t('workspace.flipTitle')} aria-label={t('workspace.flip')} onClick={onFlip}>⇅</button>
            </div>
          </div>
        )}
        {context}
        <PlayerStrip position="top" color={top} info={players[top]} lead={lead(top)} />
        <ChessBoard board={previewing ?? board} flipped={flipped} planning={planning}
          lastMove={previewing ? moves[cursor - 2]?.uci : shown.at(-1)?.uci} movable={previewing ? false : movable}
          onMove={onMove} busy={busy} showHeat={heatOn} onHoverSquare={describeSquare} gradeMark={previewing ? null : gradeMark}
          bestMove={previewing ? (preview === moves[cursor - 1]?.uci ? null : preview) : coachMarks?.arrow ?? bestShown}
          highlight={previewing ? [] : coachMarks?.highlight} annotations={previewing ? [] : coachMarks?.annotations} hidePieces={hidePieces}
          nextMove={previewing ? (preview === moves[cursor - 1]?.uci ? preview : null) : nextShown}
          evalBar={analysisMode && showEvalBar ? <EvalBar board={board} line={autoAnalysis ? topLine : null} flipped={flipped} /> : undefined} />
        <PlayerStrip position="bottom" color={bottom} info={players[bottom]} lead={lead(bottom)} />
        {analysisMode && (
          <div className="arrow-legend" aria-label={t('arrows.label')}>
            <button type="button" className="arrow-key best" aria-pressed={showBest} disabled={!autoAnalysis || !engineAvailable}
              onClick={() => bestArrow.set(!showBest)} title={t('arrows.bestTitle')}>
              <i aria-hidden="true" />{t('arrows.best')}{best && bestShown ? <b>{sanOf(engine.result, best)}</b> : null}
            </button>
            <button type="button" className="arrow-key next" aria-pressed={showNext} disabled={!next}
              onClick={() => nextArrow.set(!showNext)} title={mode === 'replay' ? t('arrows.playedTitle') : t('arrows.nextTitle')}>
              <i aria-hidden="true" />{nextLabel}{next ? <b>{next.san}</b> : null}
            </button>
            {next && best && next.uci === best && bestShown && <span className="arrow-match">✓ {t('arrows.sameMove')}</span>}
          </div>
        )}
        {!analysisMode && <>
          {playback}
          <div className="board-footnote"><span><i className="online-dot" /> <span id="board-status" role="status">{status}</span></span></div>
          <PlanningToolbar planning={planning} />
        </>}
        {heatOn && <HeatLegend info={squareInfo ?? t('heat.hint')} />}
        {boardFooter}
      </div>
      <aside className="analysis-panel" data-tab={tabbed ? activeTab : undefined}>
        {panelTop}
        {/* ←/→ stay with the board (stepping moves), so the tabs are plain buttons in the tab order. */}
        {loading ?? <>
          {tabbed && (
            <Segments className="bots-segments panel-tabs" role="group" aria-label={t('panel.label')}>
              {tabs.map(name => (
                <button key={name} type="button" id={`tab-${name}`} aria-pressed={activeTab === name} aria-controls={`panel-${name}`}
                  className={activeTab === name ? 'selected' : undefined} onClick={() => setTab(name)}>
                  {t(`panel.${name}`)}
                  {name === 'engine' && autoAnalysis && topLine && !finished && <b className="panel-tab-score">{scoreLabel(topLine)}</b>}
                </button>
              ))}
            </Segments>
          )}
          <div className="panel-page panel-moves" id="panel-moves" hidden={!shownTab('moves')}>
            {/* A reviewed game keeps the verdict's place on every move, so the list below never jumps. */}
            {judged && !busy ? <MoveVerdict initialFen={initialFen} moves={moves} cursor={cursor} judged={judged}
              bestUci={bestMoves?.[cursor - 1]} engineId={engineId} onPreview={setPreview} onGo={ply => { setPlaying(false); onGo(ply); }}
              voice={{ on: voice.on, onToggle: voice.toggle }} you={you} />
              : mode === 'replay' && !!judgments?.size && (cursor === 0
                ? <EmptyVerdict title={t('verdict.startTitle')} hint={t('verdict.startHint')} />
                : <EmptyVerdict title={t('verdict.pendingTitle')} hint={t('verdict.pendingHint')} pose="magnify" />)}
            {movesTop}
            {mode !== 'replay' && <div className="moves-heading"><span>{t('moves.heading')}</span><span id="game-result">{board?.result || resultText || t('moves.inProgress')}</span></div>}
            <MoveList initialFen={initialFen} moves={moves} cursor={cursor} onSelect={ply => { setPlaying(false); onGo(ply); }} judgments={judgments} />
          </div>
          {analysisMode && (
            <div className="panel-page panel-engine" id="panel-engine" hidden={!shownTab('engine')}>
              <EnginePanel status={engine.status} result={engine.result} auto={autoAnalysis} onToggleAuto={() => autoAnalysisSetting.set(!autoAnalysis)}
                onTryBest={() => best && onTryBest?.(best)}
                tryLabel={tryLabel} available={engineAvailable} finished={finished}
                engines={installedEngines} engineId={engineId} onEngineChange={analysisEngine.set} />
              {tabbed && engine.result && <div className="panel-mascot"><CursorRook size={150} /></div>}
            </div>
          )}
          {summary && (
            <div className="panel-page panel-summary" id="panel-summary" hidden={!shownTab('summary')}>
              <div className="panel-summary-body">{summary}</div>
              {/* Back to the start and through the game, the coach saying the highlights. */}
              {autoplay && moves.length > 0 && (
                <div className="summary-actions">
                  <button type="button" className="button primary" id="step-through"
                    onClick={() => { setTab('moves'); onGo(0); setPlaying(true); }}>{t('panel.stepThrough')}</button>
                </div>
              )}
            </div>
          )}
          {panelBottom}
          {analysisMode && playback}
        </>}
      </aside>
    </section>
  );
}
