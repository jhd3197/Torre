// /stage: the YouTube set. A full-frame, shell-less board in the Torre brand
// that the video recorder (../torre-sh-video) drives through window.__stage.
// Nothing here is interactive; every change arrives as a stage command, and
// the layout follows the window's shape (portrait for Shorts, landscape for
// long-form).
//
//   __stage.set({ fen, orientation, header, players, caption, mascot, eval, card, story, arrows, marks })
//   __stage.move('h5f7', { mark: 'brilliant' })   slide a piece, optionally badge its square
//   __stage.line(['a2a1', 'c1d2'], 900, { evals, marks })  play several moves, one every 900 ms,
//                                                 updating the eval bar and badges per move
//   __stage.countdown(5)                          resolves when it reaches zero (shown in the caption, never over the board)
//   __stage.cues                                  sounds the story beats asked for, { t: Date.now() ms, sound, gain?, pan? };
//                                                 the recorder lays them on the soundtrack (scripts/sfx_track.py)
//
// Opening /stage?fen=…&side=black shows a position without the recorder.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { START_FEN } from '../lib/format';
import { pieceSrc } from '../lib/pieces';
import { applyUci, evalLabel, fromFen, squareIndex, whiteWinPct, type StagePosition } from '../lib/stage';

type Tone = 'gold' | 'green' | 'red';
type MarkKind = 'brilliant' | 'speculative' | 'mistake' | 'blunder';

interface Player { name: string; portrait?: string; detail?: string }

/** A full-frame history beat built from the app's own illustrations.
 *  hero: one big illustration, optionally with a portrait badge;
 *  duel: two portraits facing each other; hall: a portrait on a pedestal. */
interface Story {
  layout: 'hero' | 'duel' | 'hall';
  chip?: string;
  kicker?: string;
  title: string;
  text?: string;
  art?: string;
  portrait?: string;
  /** A full-body figurine (art/video/figure-*.webp): stands instead of a round portrait. */
  figure?: string;
  left?: Player;
  right?: Player;
  /** A colour washed into the background (the venue's own: warm wood, a green room). */
  tint?: string;
}

/** When each part of a story beat arrives, in seconds from the beat's start. The CSS reads
 *  them through --d, and storyCues() schedules the sounds from the same numbers. */
const BEAT = { figure: 0.65, chip: 1.0, kicker: 1.35, title: 1.55, word: 0.13 };
const DUEL = { left: 0.2, right: 0.55, swords: 1.0, vs: 1.15, names: 1.45 };

type Sound = 'whoosh' | 'tap' | 'stamp' | 'pop' | 'clang' | 'hit';
interface Cue { t: number; sound: Sound; gain?: number; pan?: number }
type BeatCue = Omit<Cue, 't'> & { at: number };

/** The sounds a new story beat makes, `at` seconds from its start. */
function storyCues(story: Story, prev: Story | null): BeatCue[] {
  if (story.layout === 'duel') {
    return [
      { at: DUEL.left, sound: 'whoosh', gain: 0.45, pan: -0.5 }, { at: DUEL.left + 0.35, sound: 'tap', gain: 0.7, pan: -0.4 },
      { at: DUEL.right, sound: 'whoosh', gain: 0.45, pan: 0.5 }, { at: DUEL.right + 0.35, sound: 'tap', gain: 0.7, pan: 0.4 },
      { at: DUEL.swords, sound: 'clang', gain: 0.5 }, { at: DUEL.vs, sound: 'hit', gain: 0.9 },
    ];
  }
  const before = prev?.layout === story.layout ? prev : null;
  const cues: BeatCue[] = [];
  if (story.art && before?.art !== story.art) cues.push({ at: 0.05, sound: 'whoosh', gain: 0.4 });
  const figure = story.figure ?? story.portrait;
  const prevFigure = before?.figure ?? before?.portrait;
  if (figure && figure !== prevFigure) {
    cues.push(prevFigure ? { at: BEAT.figure, sound: 'pop', gain: 0.6 } : { at: BEAT.figure + 0.3, sound: 'tap', gain: 0.7 });
  }
  if (story.chip) cues.push({ at: BEAT.chip + 0.3, sound: 'stamp', gain: 0.55 });
  return cues;
}

interface Card {
  kind: 'title' | 'end';
  kicker?: string;
  title: string;
  text?: string;
  cta?: string;
  pose?: string;
}

export interface StageState {
  position: StagePosition;
  orientation: 'white' | 'black';
  lastMove: [number, number] | null;
  arrows: { from: string; to: string; tone?: Tone }[];
  marks: { square: string; kind: MarkKind }[];
  eval: number | null;
  header: { kicker?: string; title: string } | null;
  players: { white: Player; black: Player } | null;
  caption: { title?: string; text?: string } | null;
  mascot: string | null;
  countdown: number | null;
  /** Length of the running countdown, so its bar drains over the whole span. */
  countdownFrom: number | null;
  card: Card | null;
  story: Story | null;
  /** The beat before this one, so the art can cross over instead of cutting. */
  storyPrev: Story | null;
  /** The game's moves in SAN, for the move list (landscape only). */
  moves: string[] | null;
  /** How many of `moves` have been played; every move() advances it. */
  ply: number;
}

interface LineOptions { evals?: (number | null)[]; marks?: (MarkKind | null)[] }

type Patch = Partial<Omit<StageState, 'position' | 'lastMove' | 'storyPrev'>> & { fen?: string };

declare global {
  interface Window {
    __stage?: {
      ready: true;
      set: (patch: Patch) => void;
      move: (uci: string, opts?: { mark?: MarkKind; arrow?: boolean }) => void;
      line: (moves: string[], everyMs?: number, opts?: LineOptions) => Promise<void>;
      countdown: (seconds: number) => Promise<void>;
      state: () => StageState;
      cues: Cue[];
    };
  }
}

/** A CoachRook pose name, or a path to any figure (a rival's reaction, Tal's grin). */
const mascotSrc = (mascot: string) => (mascot.includes('/') ? mascot : `art/mascot/${mascot}.webp`);

const MARK_LABEL: Record<MarkKind, string> = { brilliant: '!!', speculative: '!?', mistake: '?', blunder: '??' };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function StagePage() {
  const [params] = useSearchParams();
  const [state, setState] = useState<StageState>(() => ({
    position: fromFen(params.get('fen') || START_FEN),
    orientation: params.get('side') === 'black' ? 'black' : 'white',
    lastMove: null, arrows: [], marks: [], eval: null, header: null, players: null,
    caption: null, mascot: null, countdown: null, countdownFrom: null, card: null,
    moves: null, ply: 0, story: null, storyPrev: null,
  }));
  const live = useRef(state);

  useEffect(() => {
    document.body.dataset.page = 'stage';
    const update = (fn: (s: StageState) => StageState) => {
      live.current = fn(live.current);
      setState(live.current);
    };
    const move = (uci: string, opts: { mark?: MarkKind; arrow?: boolean } = {}) => update(s => {
      const { position } = applyUci(s.position, uci);
      const to = uci.slice(2, 4);
      return {
        ...s, position,
        lastMove: [squareIndex(uci.slice(0, 2)), squareIndex(to)],
        arrows: opts.arrow ? [{ from: uci.slice(0, 2), to, tone: 'gold' }] : [],
        marks: opts.mark ? [{ square: to, kind: opts.mark }] : [],
        ply: s.moves ? s.ply + 1 : s.ply,
      };
    });
    const cues: Cue[] = [];
    window.__stage = {
      ready: true,
      set: ({ fen, ...patch }) => update(s => {
        const newStory = 'story' in patch && patch.story !== s.story;
        if (newStory && patch.story) {
          const now = Date.now();
          for (const { at, ...cue } of storyCues(patch.story, s.story)) cues.push({ ...cue, t: now + at * 1000 });
        }
        return {
          ...s, ...patch,
          ...(newStory ? { storyPrev: s.story } : {}),
          ...(fen ? { position: fromFen(fen), lastMove: null, arrows: patch.arrows ?? [], marks: patch.marks ?? [] } : {}),
        };
      }),
      move,
      line: async (moves, everyMs = 900, { evals, marks } = {}) => {
        for (const [i, uci] of moves.entries()) {
          move(uci, { mark: marks?.[i] ?? undefined });
          const cp = evals?.[i];
          if (cp !== undefined) update(s => ({ ...s, eval: cp }));
          await sleep(everyMs);
        }
      },
      countdown: async seconds => {
        for (let n = seconds; n > 0; n--) {
          update(s => ({ ...s, countdown: n, countdownFrom: seconds }));
          await sleep(1000);
        }
        update(s => ({ ...s, countdown: null, countdownFrom: null }));
      },
      state: () => live.current,
      cues,
    };
    return () => {
      delete window.__stage;
      delete document.body.dataset.page;
    };
  }, []);

  const { orientation, players } = state;
  const top = orientation === 'white' ? players?.black : players?.white;
  const bottom = orientation === 'white' ? players?.white : players?.black;

  return (
    <div className="stage">
      <header className="stage-head">
        <div className="stage-brand">
          <img src="art/logo/mark.png" alt="" />
          <span>torre.sh</span>
        </div>
        {state.header && (
          <div className="stage-title">
            {state.header.kicker && <div className="stage-kicker">{state.header.kicker}</div>}
            <h1>{state.header.title}</h1>
          </div>
        )}
      </header>

      {state.moves && <MoveList moves={state.moves} ply={state.ply} />}

      <div className="stage-play">
        {top && <PlayerTag player={top} />}
        <div className="stage-board-row">
          {/* Always laid out, so the board doesn't shift when the eval appears. */}
          <EvalBar cp={state.eval} orientation={orientation} />
          <StageBoard state={state} />
        </div>
        {bottom && <PlayerTag player={bottom} />}
      </div>

      <footer className="stage-foot">
        <div className={`stage-caption${state.caption ? ' on' : ''}${state.countdown !== null ? ' timing' : ''}`}>
          {state.caption?.title && <strong>{state.caption.title}</strong>}
          {state.caption?.text && <p>{state.caption.text}</p>}
          {state.countdown !== null && (
            <>
              <span key={state.countdown} className="stage-timer">{state.countdown}</span>
              <i className="stage-timer-bar" style={{ animationDuration: `${state.countdownFrom ?? state.countdown}s` }} />
            </>
          )}
        </div>
        {state.mascot && <img key={state.mascot} className="stage-mascot" src={mascotSrc(state.mascot)} alt="" />}
      </footer>

      {/* Kept mounted while the layout stays the same, so one beat's art crosses into the next. */}
      {state.story && <StageStory key={state.story.layout} story={state.story} prev={state.storyPrev} />}
      {state.card && <StageCard card={state.card} />}
    </div>
  );
}

/** Two moves per row, ending at the current move. Moves not played yet are
 *  never shown: in a "find the move" pause they would give the answer away. */
function MoveList({ moves, ply }: { moves: string[]; ply: number }) {
  const ROWS = 7;
  if (ply === 0) return <ol className="stage-moves empty" />;
  const current = Math.ceil(ply / 2) - 1;
  const first = Math.max(0, current - ROWS + 1);
  return (
    <ol className="stage-moves">
      {Array.from({ length: current - first + 1 }, (_, i) => {
        const row = first + i;
        return (
          <li key={row}>
            <span className="num">{row + 1}.</span>
            {[0, 1].map(side => {
              const index = row * 2 + side;
              if (index >= ply) return <span key={side} />;
              return <span key={side} className={`san${index + 1 === ply ? ' now' : ''}`}>{moves[index]}</span>;
            })}
          </li>
        );
      })}
    </ol>
  );
}

function PlayerTag({ player }: { player: Player }) {
  return (
    <div className="stage-player">
      {player.portrait && <img src={player.portrait} alt="" />}
      <span className="stage-player-name">{player.name}</span>
      {player.detail && <span className="stage-player-detail">{player.detail}</span>}
    </div>
  );
}

function EvalBar({ cp, orientation }: { cp: number | null; orientation: 'white' | 'black' }) {
  const white = cp === null ? 50 : whiteWinPct(cp);
  return (
    <div className={`stage-eval${orientation === 'black' ? ' flipped' : ''}${cp === null ? ' off' : ''}`}>
      <div className="stage-eval-white" style={{ height: `${white}%` }} />
      {cp !== null && <span className={cp >= 0 ? 'white' : 'black'}>{evalLabel(cp)}</span>}
    </div>
  );
}

function StageBoard({ state }: { state: StageState }) {
  const flip = state.orientation === 'black';
  const view = (square: number) => (flip ? 63 - square : square);
  const xy = (name: string) => {
    const v = view(squareIndex(name));
    return { x: (v % 8) + 0.5, y: Math.floor(v / 8) + 0.5 };
  };
  const last = useMemo(() => new Set(state.lastMove ?? []), [state.lastMove]);

  return (
    <div className="stage-board">
      {Array.from({ length: 64 }, (_, v) => {
        const square = flip ? 63 - v : v;
        const dark = (Math.floor(v / 8) + (v % 8)) % 2 === 1;
        return <span key={v} className={`stage-sq${dark ? ' dark' : ''}${last.has(square) ? ' last' : ''}`} />;
      })}

      {state.position.pieces.map(piece => {
        const v = view(piece.square);
        return (
          <img key={piece.id} className="stage-piece" src={pieceSrc(piece.symbol, 'staunton')} alt=""
            style={{ transform: `translate(${(v % 8) * 100}%, ${Math.floor(v / 8) * 100}%)` }} />
        );
      })}

      <svg className="stage-arrows" viewBox="0 0 8 8" aria-hidden="true">
        <defs>
          {(['gold', 'green', 'red'] as const).map(tone => (
            <marker key={tone} id={`stage-head-${tone}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" className={`tone-${tone}`} />
            </marker>
          ))}
        </defs>
        {state.arrows.map(({ from, to, tone = 'gold' }) => {
          const a = xy(from), b = xy(to);
          // Only a knight's move is one square one way and two the other: it bends, along the
          // long leg first, as the app's arrows do (lib/boardTools arrowPath).
          const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
          const knight = (dx === 1 && dy === 2) || (dx === 2 && dy === 1);
          const corner = knight ? (dx > dy ? { x: b.x, y: a.y } : { x: a.x, y: b.y }) : a;
          const len = Math.hypot(b.x - corner.x, b.y - corner.y);
          const end = { x: b.x - ((b.x - corner.x) / len) * 0.3, y: b.y - ((b.y - corner.y) / len) * 0.3 };
          const d = knight ? `M${a.x},${a.y} L${corner.x},${corner.y} L${end.x},${end.y}` : `M${a.x},${a.y} L${end.x},${end.y}`;
          return <path key={`${from}${to}`} className={`shaft tone-${tone}`} d={d} markerEnd={`url(#stage-head-${tone})`} />;
        })}
      </svg>

      {state.marks.map(({ square, kind }) => {
        const v = view(squareIndex(square));
        return (
          <span key={square} className={`stage-mark ${kind}`}
            style={{ left: `${((v % 8) + 1) * 12.5}%`, top: `${Math.floor(v / 8) * 12.5}%` }}>
            {MARK_LABEL[kind]}
          </span>
        );
      })}

    </div>
  );
}

const delay = (seconds: number) => ({ '--d': `${seconds}s` }) as CSSProperties;

/** A title that arrives one word at a time. */
function Words({ text, from }: { text: string; from: number }) {
  return (
    <>
      {text.split(' ').map((word, i) => (
        <span key={i} className="word" style={delay(from + i * BEAT.word)}>{word} </span>
      ))}
    </>
  );
}

function StageStory({ story, prev }: { story: Story; prev: Story | null }) {
  const before = prev?.layout === story.layout ? prev : null;
  const figure = story.figure ?? story.portrait;
  const prevFigure = before?.figure ?? before?.portrait;
  const words = story.title.split(' ').length;
  return (
    <div className={`stage-story ${story.layout}`}>
      {story.tint && <i key={story.tint} className="stage-story-tint" style={{ '--tint': story.tint } as CSSProperties} />}
      <div className="stage-story-art">
        {story.layout === 'hero' && (
          <>
            {before?.art && before.art !== story.art && <img key={`out-${before.art}`} className="art leaving" src={before.art} alt="" />}
            {story.art && <img key={story.art} className="art" src={story.art} alt="" />}
            {prevFigure && prevFigure !== figure && <img key={`out-${prevFigure}`} className="figure leaving" src={prevFigure} alt="" />}
            {figure && (
              <img key={figure} className={story.figure ? 'figure' : 'badge'} src={figure} alt=""
                style={delay(prevFigure ? 0.15 : BEAT.figure)} />
            )}
          </>
        )}
        {story.layout === 'duel' && (
          <>
            {story.art && <img className="backdrop" src={story.art} alt="" />}
            {[story.left, story.right].map((p, i) => p && (
              <figure key={i} className={i ? 'right' : 'left'} style={delay(i ? DUEL.right : DUEL.left)}>
                <i className="spot" />
                {p.portrait && <img className="figure" src={p.portrait} alt="" />}
                <img className="pedestal" src="art/legends/hall-pedestal.webp" alt="" />
                <figcaption style={delay(DUEL.names)}>{p.name}{p.detail && <small>{p.detail}</small>}</figcaption>
              </figure>
            ))}
            <div className="versus">
              <img className="swords" src="art/legends/hall-swords.webp" alt="" style={delay(DUEL.swords)} />
              <span className="vs" style={delay(DUEL.vs)}>VS</span>
            </div>
          </>
        )}
        {story.layout === 'hall' && (
          <>
            <img className="banner left" src="art/legends/hall-banner.webp" alt="" />
            <img className="banner right" src="art/legends/hall-banner.webp" alt="" />
            <div className="podium">
              {story.figure
                ? <img className="figure" src={story.figure} alt="" style={delay(BEAT.figure)} />
                : story.portrait && <img className="badge" src={story.portrait} alt="" style={delay(BEAT.figure)} />}
              <img className="pedestal" src="art/legends/hall-pedestal.webp" alt="" />
            </div>
          </>
        )}
      </div>
      <div key={story.title} className="stage-story-text">
        {story.chip && <span className="chip" style={delay(BEAT.chip)}>{story.chip}</span>}
        {story.kicker && <div className="stage-kicker" style={delay(BEAT.kicker)}>{story.kicker}</div>}
        <h1><Words text={story.title} from={BEAT.title} /></h1>
        {story.text && <p style={delay(BEAT.title + words * BEAT.word + 0.25)}>{story.text}</p>}
      </div>
    </div>
  );
}

function StageCard({ card }: { card: Card }) {
  return (
    <div className={`stage-card ${card.kind}`}>
      {card.kind === 'end' && <img className="stage-card-logo" src="art/logo/mark.png" alt="" />}
      {card.pose && <img className="stage-card-mascot" src={`art/mascot/${card.pose}.webp`} alt="" />}
      {card.kicker && <div className="stage-kicker">{card.kicker}</div>}
      <h1>{card.title}</h1>
      {card.text && <p>{card.text}</p>}
      {card.cta && <div className="stage-cta">{card.cta}</div>}
    </div>
  );
}
