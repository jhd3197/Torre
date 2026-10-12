// App-wide choices remembered in this browser. Each one is shared, so every board on the page follows a change at once.
// Every key is `chess-jd-<name>`; a setting renamed from an older key lists it in `legacyKeys`,
// and the first read moves the stored value across.
import { useSyncExternalStore } from 'react';

export interface Setting<T> {
  key: string;
  /** The value before anybody chooses, and after Reset to defaults. */
  fallback: T;
  get: () => T;
  set: (value: T) => void;
  use: () => T;
  /** Called after every change; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void;
  /** Forget the cached value (tests start from storage again). */
  reset: () => void;
}

const created: Setting<string>[] = [];
/** Forget every cached setting (tests start from storage again). */
export const resetSettings = () => created.forEach(setting => setting.reset());
/** Every setting back to its default, except the ones listed by key (the language stays as chosen). */
export const restoreDefaults = (keep: readonly string[] = ['chess-jd-language']) => created
  .filter(setting => !keep.includes(setting.key)).forEach(setting => setting.set(setting.fallback));

function storedValue(key: string, legacyKeys: readonly string[]): string | null {
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) return stored;
    for (const old of legacyKeys) {
      const value = localStorage.getItem(old);
      if (value === null) continue;
      localStorage.setItem(key, value);
      localStorage.removeItem(old);
      return value;
    }
  } catch { /* storage unavailable */ }
  return null;
}

/** A shared choice; `allowed` lists its values, or tests a free-form one such as an engine id. */
export function createSetting<T extends string>(
  key: string, fallback: T, allowed: readonly T[] | ((value: string) => boolean),
  onChange?: (value: T) => void, legacyKeys: readonly string[] = [],
): Setting<T> {
  let current: T | null = null;
  const listeners = new Set<() => void>();
  const valid = typeof allowed === 'function' ? allowed : (value: string) => (allowed as readonly string[]).includes(value);
  const get = () => {
    if (current === null) {
      const stored = storedValue(key, legacyKeys);
      current = stored !== null && valid(stored) ? stored as T : fallback;
    }
    return current;
  };
  const set = (value: T) => {
    current = value;
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
    onChange?.(value);
    listeners.forEach(listener => listener());
  };
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const setting = { key, fallback, get, set, subscribe, use: () => useSyncExternalStore(subscribe, get, get), reset: () => { current = null; } };
  created.push(setting as unknown as Setting<string>);
  return setting;
}

/** An on/off setting, stored as "1"/"0". */
export function createFlag(key: string, fallback: boolean, legacyKeys: readonly string[] = []): Setting<boolean> {
  const flag = createSetting<'1' | '0'>(key, fallback ? '1' : '0', ['1', '0'], undefined, legacyKeys);
  return {
    key,
    fallback,
    get: () => flag.get() === '1',
    set: value => flag.set(value ? '1' : '0'),
    use: () => flag.use() === '1',
    subscribe: flag.subscribe,
    reset: flag.reset,
  };
}

/** A level from 0 to 100 (a volume), stored as its digits. */
export function createLevel(key: string, fallback: number, onChange?: (value: number) => void): Setting<number> {
  const valid = (value: string) => /^\d{1,3}$/.test(value) && Number(value) <= 100;
  const level = createSetting<string>(key, String(fallback), valid, onChange && (value => onChange(Number(value))));
  const clamp = (value: number) => String(Math.round(Math.max(0, Math.min(100, value))));
  return {
    key,
    fallback,
    get: () => Number(level.get()),
    set: value => level.set(clamp(value)),
    use: () => Number(level.use()),
    subscribe: level.subscribe,
    reset: level.reset,
  };
}

/** Board colours: each theme sets the two square colours in brand.css. High contrast is for low vision. */
export const BOARD_THEMES = ['forest', 'stone', 'walnut', 'contrast'] as const;
export type BoardTheme = typeof BOARD_THEMES[number];

const applyBoardTheme = (theme: BoardTheme) => { document.documentElement.dataset.boardTheme = theme; };
export const boardTheme = createSetting<BoardTheme>('chess-jd-board-theme', 'forest', BOARD_THEMES, applyBoardTheme);

/** A choice the stylesheet reads from a data attribute on <html>; the default leaves it unset. */
function rootChoice<T extends string>(key: string, fallback: T, allowed: readonly T[], attribute: string) {
  const apply = (value: T) => {
    if (value === fallback) delete document.documentElement.dataset[attribute];
    else document.documentElement.dataset[attribute] = value;
  };
  return { setting: createSetting<T>(key, fallback, allowed, apply), apply };
}

/** Animations: as the system asks (prefers-reduced-motion), always reduced, or always full.
 *  The stylesheet's reduced-motion and motion-ok mixins read data-motion. */
export const MOTION_CHOICES = ['system', 'reduce', 'full'] as const;
const motionChoice = rootChoice('chess-jd-motion', 'system', MOTION_CHOICES, 'motion');
export const motion = motionChoice.setting;
/** Whether animations should stay still right now: chosen here, or asked for by the system. */
export function motionReduced(): boolean {
  const choice = motion.get();
  if (choice !== 'system') return choice === 'reduce';
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The whole interface a step larger: text, buttons and the board (the stylesheet zooms the page). */
export const UI_SIZES = ['normal', 'large', 'larger'] as const;
const uiSizeChoice = rootChoice('chess-jd-ui-size', 'normal', UI_SIZES, 'uiSize');
export const uiSize = uiSizeChoice.setting;

/** Arrow and highlight colours: the house ones, or a set told apart without red and green. */
export const PALETTES = ['standard', 'colorblind'] as const;
const paletteChoice = rootChoice('chess-jd-palette', 'standard', PALETTES, 'palette');
export const palette = paletteChoice.setting;

/** Call once at start-up so the saved looks apply before the first board draws. */
export const applySavedSettings = () => {
  applyBoardTheme(boardTheme.get());
  motionChoice.apply(motion.get());
  uiSizeChoice.apply(uiSize.get());
  paletteChoice.apply(palette.get());
};

/** Where the app opens: Home, or straight into another page. */
export const START_PAGES = ['home', 'story', 'play', 'puzzles', 'coach'] as const;
export type StartPage = typeof START_PAGES[number];
export const startPage = createSetting<StartPage>('chess-jd-start-page', 'home', START_PAGES);
/** Settings rows show their description in full, instead of behind an (i). */
export const settingNotes = createFlag('chess-jd-setting-notes', false);

/** The board: coordinates, the last move's squares, dots on the legal targets, dragging pieces. */
export const coordinates = createFlag('chess-jd-coordinates', true);
export const lastMoveHighlight = createFlag('chess-jd-last-move', true);
export const legalDots = createFlag('chess-jd-legal-dots', true);
export const dragPieces = createFlag('chess-jd-drag-pieces', true);
/** A pawn reaching the last rank becomes a queen without asking. */
export const autoQueen = createFlag('chess-jd-auto-queen', false);
/** How a moved piece slides to its square: not at all, quickly, or at the usual pace. */
export const MOVE_ANIMATIONS = ['off', 'fast', 'normal'] as const;
export type MoveAnimation = typeof MOVE_ANIMATIONS[number];
export const moveAnimation = createSetting<MoveAnimation>('chess-jd-move-animation', 'normal', MOVE_ANIMATIONS);
/** A screen reader hears each move that lands on the board. */
export const announceMoves = createFlag('chess-jd-announce-moves', false);
/** A box under the board takes typed moves (e4, Nf3, O-O, e2e4). */
export const typedMoves = createFlag('chess-jd-typed-moves', false);

/** Workspace analysis helpers, shared by Settings and every mounted board. */
export const autoAnalysis = createFlag('chess-jd-auto-analysis', true);
export const bestArrow = createFlag('chess-jd-best-arrow', true);
export const squareControl = createFlag('chess-jd-square-control', true);
export const nextArrow = createFlag('chess-jd-next-arrow', true);
/** The review narrator speaking each graded move. */
export const reviewVoice = createFlag('chess-jd-review-voice', true);
/** Puzzles with the pieces hidden. */
export const puzzleBlindfold = createFlag('chess-jd-puzzle-blindfold', false, ['puzzles.blindfold']);
/** Games against bots with the pieces hidden. */
export const playBlindfold = createFlag('chess-jd-play-blindfold', false);
/** A cleanly solved puzzle moves on to the next one by itself. */
export const puzzleAutoNext = createFlag('chess-jd-puzzle-auto-next', false);
/** What a puzzle offers when stuck: a hint and the solution, or the hint only. Hard mode offers neither. */
export const PUZZLE_HELP = ['full', 'hint'] as const;
export const puzzleHelp = createSetting<typeof PUZZLE_HELP[number]>('chess-jd-puzzle-help', 'full', PUZZLE_HELP);
/** Your puzzle rating and its changes, shown while solving. */
export const showRatings = createFlag('chess-jd-show-ratings', true);
/** Hard mode: lessons and puzzles offer no hints and never show the answer; you work it out. */
export const hardMode = createFlag('chess-jd-hard-mode', false);
/** The coach stays quiet while you play: no spoken quips, only what you ask for. */
export const quietCoach = createFlag('chess-jd-quiet-coach', false);
/** Character bots talk during a game: a line in their bubble at a check, a capture, a blunder. */
export const botChatter = createFlag('chess-jd-bot-chatter', true);
/** The rail folded ("1") or open ("0"); empty until somebody chooses, so the screen width decides. */
export const railFolded = createSetting<'' | '1' | '0'>('chess-jd-rail-folded', '', ['1', '0'], undefined, ['studio.nav.collapsed']);
/** The workspace analysis engine (an engines.py id); an uninstalled choice falls back to Stockfish where it is used. */
export const analysisEngine = createSetting<string>('chess-jd-analysis-engine', 'stockfish', value => value !== '');
/** The evaluation bar beside analysis boards. */
export const evalBar = createFlag('chess-jd-eval-bar', true);
/** How many engine lines the analysis panel lists. */
export const ENGINE_LINES = ['1', '2', '3'] as const;
export const engineLines = createSetting<typeof ENGINE_LINES[number]>('chess-jd-engine-lines', '3', ENGINE_LINES);
/** How long the engine thinks about each position while you analyze (api/engine `depth`). */
export const ANALYSIS_DEPTHS = ['quick', 'normal', 'deep'] as const;
export type AnalysisDepth = typeof ANALYSIS_DEPTHS[number];
export const analysisDepth = createSetting<AnalysisDepth>('chess-jd-analysis-depth', 'normal', ANALYSIS_DEPTHS);
