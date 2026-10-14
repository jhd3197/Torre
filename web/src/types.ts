import type { DrillKind, DrillPiece } from './lib/drills';
// Shapes returned by studio.py. Legal moves and game state always come from python-chess.

export type Color = 'white' | 'black';

export interface SquareControl { white: string[]; black: string[] }

export interface BoardState {
  fen: string;
  turn: Color;
  pieces: Record<string, string>;
  legal: string[];
  check: string | null;
  result: string | null;
  termination: string | null;
  plans: Record<string, string[]>;
  control: Record<string, SquareControl>;
}

/** `clock`: the mover's seconds left after the move, when the game recorded clocks (PGN [%clk]). */
export interface Move { uci: string; san: string; clock?: number }

/** A line of play: a start position and the moves played from it. */
export interface Line { initialFen: string; moves: Move[] }

export interface EngineLine { cp: number; mate: number | null; moves: string[]; uci: string[]; depth?: number }
export interface EngineResult { lines: EngineLine[]; best: string | null; grade?: MoveGrade | null }

export type Grade = 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'book' | 'forced'
  | 'inaccuracy' | 'miss' | 'mistake' | 'blunder';
export interface MoveGrade {
  class: Judgment | null;
  best: boolean;
  brilliant: boolean;
  great?: boolean;
  book?: boolean;
  /** Not the engine's move, but within 0.02 winning chances of it. */
  excellent?: boolean;
  /** A chance let go: a forced mate, or the opponent's slip left unpunished (scoring.is_miss). */
  miss?: boolean;
  /** The only legal move: never judged. */
  forced?: boolean;
  accuracy: number;
}

export type Judgment = 'inaccuracy' | 'mistake' | 'blunder';

export interface GameSummary {
  id: number | string;
  date?: string;
  opponent?: string;
  user_color?: Color;
  user_result?: number | null;
  user_rating?: number;
  opp_rating?: number;
  plies?: number;
  user_accuracy?: number | null;
  type?: string;
}

export interface AnalyzedMove extends MoveGrade {
  ply: number;
  san: string;
  class: Judgment | null;
  best: boolean;
  brilliant: boolean;
  accuracy: number;
}

export interface WorstMove {
  ply: number;
  move_number: number;
  san: string;
  fen: string;
  class: Judgment | null;
  cpl: number;
}

export interface GameAnalysis {
  id: number | string;
  scoring_version?: number;
  accuracy?: number | null;
  opp_accuracy?: number | null;
  worst_moves?: WorstMove[];
  moves?: AnalyzedMove[];
  evals?: [number | null, number | null][];
  best_moves?: (string | null)[];
  /** Every ply's grade, both sides (index = ply - 1). */
  move_grades?: MoveGrade[];
  /** Your turning points: brilliant moves, then the biggest slips (scoring.key_moments). */
  key_moments?: import('./components/KeyMoments').KeyMoment[];
}

export interface GameDetail extends Line {
  headers: Record<string, string>;
  opening?: {
    name: string; eco: string; ply: number; move_number: number; move: string;
    played_by: Color; line: string; moves: string[]; transposed: boolean;
    family_idea: string | null; continuation: string[];
  } | null;
  record?: GameSummary & { pgn?: string };
  analysis?: GameAnalysis | null;
  /** Accuracy by phase for you and your opponent, once analyzed (bot_report.report). */
  phases?: import('./components/BotReport').BotReportData['phases'] | null;
}

// The engine registry (engines.py), from GET /api/engines.
export interface EngineModel {
  id: string;
  name: string;
  weights?: string;
  installed?: boolean;
  rating_target?: number;
  style?: string;
  download?: { url: string; size?: number | null; sha256?: string | null } | null;
}

/** One platform's release asset, pinned by the server catalog. */
export interface EngineDownload {
  url: string;
  archive: 'raw' | 'zip';
  binary_relpath?: string | null;
  size?: number | null;
  sha256?: string | null;
  cpu?: string;
}

export interface EngineInfo {
  id: string;
  name: string;
  version: string | null;
  /** 'nnue', 'neural' or 'custom'. */
  type: string;
  protocol: string;
  capabilities: { limit_strength: boolean; skill_level: boolean; multipv: boolean };
  strength_ccrl: number | null;
  license: string;
  repo_url: string;
  description: string;
  custom: boolean;
  installed: boolean;
  models: EngineModel[];
  download: Partial<Record<'windows' | 'linux' | 'macos', EngineDownload>> | null;
}

/** A UCI option as the engine's binary declares it. */
export interface UciOption {
  name: string;
  type: 'check' | 'spin' | 'combo' | 'button' | 'string' | string;
  default: string | number | boolean | null;
  min: number | null;
  max: number | null;
  var: string[];
}

export type ProfileValue = string | number | boolean;

/** GET /api/engines/profile — an engine's saved options and what it reports (null when it could not be asked). */
export interface EngineProfile {
  engineId: string;
  options: Record<string, ProfileValue>;
  reported: UciOption[] | null;
}

/** GET /api/engines/install — the background download, polled while it runs. */
export interface EngineInstallStatus {
  running: boolean;
  engine_id: string | null;
  model_id: string | null;
  phase: 'download' | 'extract' | 'probe' | 'done' | null;
  downloaded: number;
  total: number;
  error: string | null;
}

export interface AnalysisStatus {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  /** The game being analyzed, or `mining` while its mistakes become puzzles. */
  current: { opponent?: string; date?: string; mining?: boolean } | null;
  error: string | null;
  remaining?: number;
  outdated?: number;
  engine: boolean;
  /** New games are analyzed in the background (data/settings.json auto_analyze). */
  auto?: boolean;
  /** Puzzles in the "From your games" pack, after a mining pass. */
  my_puzzles?: number;
}

export interface DrillCard {
  id: string;
  game_id: number | string;
  ply: number;
  fen: string;
  class: Judgment;
  move_number: number;
  opponent?: string;
  date?: string;
  /** A forced mate in this many you let go in the game (drills.missed_mate_cards). */
  mate?: number;
  /** "lesson" for a lesson's exercise brought back for review (drills.add_lesson_card). */
  source?: 'lesson';
  lesson?: string;
  lesson_title?: string;
}

export interface DrillDeck {
  total: number;
  learned: number;
  due: number;
  new: number;
  new_total: number;
  new_per_day: number;
  /** Cards the scheduler would not show again for three weeks: fixed for good. */
  mastered?: number;
  next_due: string | null;
  /** Lesson exercises in today's queue (the Lessons page offers them). */
  lesson_due?: number;
  card: DrillCard | null;
}

/** GET /api/today: the day's plan for fixing your mistakes (studio.today_view). */
export interface TodayPlan {
  drills: { due: number; new: number; new_total: number; total: number; learned: number; mastered?: number; next_due: string | null };
  reviews: { due: number; scheduled: number; next_due: string | null };
  mine: { total: number; fresh: number; today: number };
  todo: number;
}

export interface DrillAnswer {
  correct: boolean;
  verdict: 'best' | 'mate' | 'good' | Judgment;
  san: string;
  best_san: string;
  best: string;
  played: string;
  game_id: number | string;
  ply: number;
  next_review: string;
  next: DrillDeck;
}

export interface SeriesPoint { id: number | string; date: string; acpl: number | null; acc: number | null; blunders: number; result: number; opp: string }
export interface PhaseStat { phase: string; moves: number; acpl: number; blunders: number; mistakes: number }
export interface ColorStat { color: Color; games: number; winrate: number; acpl: number | null; bl_per_game: number | null }
export interface OpponentStat { opp: string; games: number; w: number; d: number; l: number; acpl: number | null }
export interface OpeningStat {
  eco: string; name: string; color: string; games: number; winrate: number; w: number; d: number; l: number;
  fen: string; line: string; acpl: number | null; analyzed: number;
  recent: { id: number | string; opp: string; date: string; result: number }[];
}
export interface RecurringPosition { fen: string; name: string; count: number; eco: string }
export interface Concept { tag: string; title: string; evidence: string; text: string; fen?: string; lesson?: string; links?: { label: string; url: string }[] }
export interface WorstBlunder { id: number | string; ply: number; fen: string; cpl: number; class?: Judgment | null; date: string; opp: string; san: string; move_number: number; board?: string[][] }

export interface InsightsData {
  user?: string;
  games: number; wins: number; draws: number; losses: number;
  avgAcc: number | null; avgCpl: number | null; blPerGame: number | null;
  /** Every analyzed move of yours by grade (scoring.grade); older servers send none. */
  grades?: Partial<Record<Grade, number>>;
  gradeCoverage?: { current: number; total: number };
  totalBlunders: number; mistakes: number; inaccuracies: number;
  coverage: { analyzed: number; total: number };
  series: SeriesPoint[];
  phases: PhaseStat[];
  colors: ColorStat[];
  opponents: OpponentStat[];
  openings: OpeningStat[];
  recurring: RecurringPosition[];
  concepts: Concept[];
  worstBlunders: WorstBlunder[];
}

// Lessons (lessons.py). Steps are checked and normalized by the server.
export type LessonCategory = 'basics' | 'openings' | 'tactics' | 'checkmates' | 'endgames' | 'strategy' | 'history';
export type LessonLevel = 'beginner' | 'intermediate' | 'advanced';
/** A circle when `from` equals `to`, otherwise an arrow. */
export interface LessonMark { from: string; to: string }

interface StepBase {
  id: string; title: string | null; orientation: Color; marks: LessonMark[];
  /** Finishing it posts a result (lessons.py is_scored); explain, card, reel and watched drills do not. */
  scored?: boolean;
  /** The lesson rule (Lesson.rules) this step practises, for the recap. */
  rule?: string;
}
export interface ExplainStep extends StepBase {
  kind: 'explain'; fen: string; text: string; demo: Move[];
  /** Spoken coach line for the step (audio at /art/audio/lessons/<slug>/<id>.mp3). */
  narration?: string;
  /** Mascot pose shown beside the step (see lessons.py POSES). */
  pose?: string;
}
/** One line of a play step: the reader's moves and the replies, alternating; the reader moves first and last. */
export interface PlayLine {
  moves: Move[];
  /** Other accepted final moves. */
  alternatives: Move[];
  mate: boolean;
}
export interface PlayStep extends StepBase, PlayLine {
  kind: 'play'; fen: string; prompt: string; success: string | null;
  /** The hint ladder's text rungs: a general nudge ("look for a fork"), then the step's own hint. */
  nudge?: string | null;
  hint: string | null;
  /** Other whole lines from the same position: where they part at a reply, the opponent picks one. */
  branches?: (PlayLine & { success: string | null })[];
  narration?: string;
  pose?: string;
}
/** A concept card: the idea in a sentence or two, a few points with icons, an optional diagram. */
export interface CardStep extends StepBase {
  kind: 'card'; fen: string | null; text: string;
  /** `icon` is a piece letter ("k", "B") or a short symbol ("✕"). */
  points: { icon: string; label: string }[];
  highlight: string[];
  narration?: string;
  pose?: string;
}
export interface ChooseStep extends StepBase {
  kind: 'choose'; fen: string | null; question: string;
  /** "Pick the board": each option is its own position. */
  options: { text: string; correct: boolean; why: string | null; fen?: string }[];
  /** Marks shown on the board once the question is answered (the attacked square, the escape squares). */
  reveal?: LessonMark[];
  narration?: string;
  pose?: string;
}
export interface ReelStep extends StepBase {
  kind: 'reel'; fen: string; text: string;
  /** The whole game (or segment), played back like a video. */
  moves: Move[];
  /** Subtitles: a caption shows once its ply is on the board. */
  notes: { ply: number; text: string }[];
  narration?: string;
  pose?: string;
}
/** One stop in a guess step: moves 1..ply-1 are on the board and the reader finds move `ply`. */
export interface GuessStop { ply: number; prompt: string; nudge?: string | null; hint: string | null; why: string | null; also: Move[] }
export interface GuessStep extends Omit<ReelStep, 'kind'> {
  kind: 'guess';
  guesses: GuessStop[];
}
/**
 * A drill (lib/drills.ts): a little game for one piece on a bare board. The step is a recipe;
 * the page makes a fresh solvable layout from it each time, so a repeat is a new position.
 */
export interface DrillStep extends Omit<StepBase, 'marks'> {
  kind: DrillKind;
  piece: DrillPiece;
  stars?: number;
  blockers?: number;
  enemies?: number;
  distance?: number;
  /** stars only: the coach collects them while you watch. */
  watch?: boolean;
  /** Overrides for the page's own wording. */
  prompt?: string;
  nudge?: string;
  success?: string;
  narration?: string;
  pose?: string;
}
export type LessonStep = ExplainStep | CardStep | PlayStep | ChooseStep | ReelStep | GuessStep | DrillStep;

interface LessonInfo {
  slug: string; title: string; summary: string; category: LessonCategory; level: LessonLevel; minutes: number;
  requires: string[];
  /** The series the lesson belongs to within its category ("Paul Morphy"), shown as a heading on the path. */
  unit: string | null;
  /** The series name to show, in the reader's language (`unit` stays the English key). */
  unitTitle?: string | null;
  /** A puzzle theme slug to practise the idea on once the lesson is done. */
  practice: string | null;
  /** A YouTube video on the same game or idea (the lesson file's `video`). */
  video?: LessonVideo | null;
  /** Steps finished (a step index); equal to the step count once the lesson is done. */
  step: number;
  completed: string | null;
  /** Marked known without being taken ("I already know this", or a placement check): no stars. */
  skipped?: boolean;
}
export interface LessonVideo { youtube: string }
export interface LessonCard extends LessonInfo { steps: number }
/** One thing the lesson teaches, in a line; the recap shows each with how it went. */
export interface LessonRule { id: string; title: string; text: string; icon: string | null }
export interface Lesson extends LessonInfo {
  orientation: Color; steps: LessonStep[];
  /** What the lesson teaches, for the recap at its end (empty: no recap). */
  rules?: LessonRule[];
  /** Per-step result ledger, keyed by step id (stars and XP are derived from these). */
  stepResults?: Record<string, StepResult>;
  /** 0–3 stars for the lesson, derived server-side from the step ledger. */
  stars?: number;
  /** Set when the coach built this lesson (coach_lessons.py): from a game, or a day's session on a skill. */
  coach?: CoachLessonInfo;
}
export interface CoachLessonInfo {
  kind: 'game' | 'session' | 'placement'; skill: string | null; game: string | null; opponent?: string | null; day?: string | null;
  /** A placement check: its category, and the lesson each check step stands for (by step id). */
  category?: LessonCategory; lessons?: Record<string, string>;
}
export interface LessonCatalog { lessons: LessonCard[]; problems: string[] }

/** What a scored step posts on completion; the server adds completedAt and derives XP/stars. */
export interface StepReport { firstTry: boolean; hintsUsed: number; revealsUsed: number; attempts: number }
export interface StepResult extends StepReport { completedAt: string }
/** Response of POST /api/lessons/<slug>/steps/<step_id>. */
export interface StepScore { ok: boolean; xpGained: number; xp: number; level: number }
/** The daily streak: consecutive days meeting the XP goal, and today's progress toward it. */
export interface Streak {
  count: number; doneToday: boolean; goal: number; xpToday: number;
  /** Streak freezes in hand: each covers one missed day on its own (one earned every 7 days, 2 at most). */
  freezes?: number;
}
/** GET /api/profile — lifetime XP and the level derived from it. */
export interface Profile { xp: number; level: number; xpIntoLevel: number; xpForLevel: number; streak: Streak }

// Puzzles (puzzles.py), from the Lichess puzzle database.
export type PuzzleGroup = 'checkmates' | 'tactics' | 'endgames';
export interface PuzzleTheme {
  slug: string; title: string; summary: string; group: PuzzleGroup; count: number;
  attempted: number; solved_first: number; missed: number; low: number | null; high: number | null;
}
export interface PuzzleAttempt {
  id: string; at: string; result: 'solved' | 'missed';
  /** Wrong moves tried before finding the solution, as SAN. */
  misses: string[]; hint: boolean; revealed: boolean; seconds: number | null;
  puzzle_rating: number; rated: boolean; delta: number; rating: number;
  themes?: string[]; missed_left?: number;
  /** Graded score in [0, 1.2]: 1 is a clean solve, partial credit after wrong moves, extra for speed. */
  score?: number; time_bonus?: number;
  /** Awards this attempt unlocked or raised a tier. */
  improved?: { id: string; title: string; tier: string }[];
}
export interface PuzzleCatalog {
  rating: number; rated: number; total: number; missed: number;
  /** Rating after each of the last rated attempts. */
  trend: number[];
  themes: PuzzleTheme[]; groups: PuzzleGroup[]; recent: PuzzleAttempt[]; problems: string[];
  /** The weakest theme slugs (low first-try rate, enough tries), weakest first. */
  weak?: string[];
  /** Best score and runs played for each unrated run. */
  runs?: Record<PuzzleRunMode, { best: number; played: number }>;
  /** Rating change from rated attempts in the last seven days. */
  week?: number;
  /** Mean seconds of the recent solves; null before any timed solve. */
  avg_seconds?: number | null;
}
/** Unrated runs: Streak ends on the first mistake, Storm is a timed sprint. */
export type PuzzleRunMode = 'streak' | 'storm';
/** POST /api/puzzles/run — a finished run, saved for its best score only. */
export interface PuzzleRunResult { mode: PuzzleRunMode; score: number; best: number; new_best: boolean; played: number }
export interface Puzzle {
  id: string;
  /** The position before the opponent's move `setup`; the solver moves after it. */
  fen: string; setup: Move;
  /** The solution: the solver's moves and the replies, alternating, solver first and last. */
  moves: Move[];
  rating: number; mate: boolean; themes: { slug: string; title: string }[]; game: string | null;
  progress: { attempts: number; solved: number; first: 'solved' | 'missed'; last: 'solved' | 'missed'; last_at: string; best_seconds?: number } | null;
}

/** A legend: a player built from a master's own games (masters.py), from GET /api/masters. */
export interface MasterInfo {
  id: string;
  name: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Highest rating in their games' headers; null for players from before ratings. */
  peak: number | null;
  /** The rating the engine plays at once their games run out. */
  elo: number;
  rated: boolean;
  years: [number, number] | null;
  /** From POST /api/masters/prepare, once the book is built. */
  openings?: { white: [string, number][]; black: Record<string, [string, number][]> };
  positions?: number;
}

/** A legend's move from their own games: how often they played it here, and one game it came from. */
export interface BookHit {
  count: number;
  total: number;
  game: { opponent: string; year: number | null; result: string; event: string };
}

/** How hard an AI player thinks: the provider's reasoning effort. */
export type ArenaAiEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** /api/arena/models: one model the Arena offers ("claude/claude-fable-5-1"), from Prompture's catalogue. */
export interface ArenaAiModel {
  id: string;
  name: string;
  released: string;
  /** The efforts it takes; empty when it does not reason (or the catalogue does not say). */
  efforts: ArenaAiEffort[];
  /** Dollars per million tokens. */
  cost: { input: number; output: number | null } | null;
}

export interface ArenaAiProvider { id: string; name: string; local: boolean; has_key: boolean; models: ArenaAiModel[] }

/** An AI player (arena.AiPlayer): a model through Prompture's chess harness. */
export interface ArenaAiSpec {
  /** Provider and model, as Prompture names them: "claude/claude-fable-5-1". */
  model: string;
  /** How much the harness helps: 0 shows every legal move and nothing else; 2 and up lean on Stockfish. */
  level?: number;
  effort?: ArenaAiEffort | null;
  name?: string;
}

/** One side of an Arena match, as POST /api/arena/start takes it. */
export interface ArenaPlayerSpec {
  ai?: ArenaAiSpec;
  engineId?: string;
  modelId?: string;
  masterId?: string;
  elo?: number;
  /** Search this many nodes per move instead of thinking for the movetime (a smoother strength curve). */
  nodes?: number;
  /** A depth cap per move, alone or with `nodes`. */
  depth?: number;
}

export interface ArenaPlayer {
  name: string;
  /** Null for an AI player. */
  engineId: string | null;
  modelId: string | null;
  masterId: string | null;
  elo: number | null;
  nodes?: number | null;
  depth?: number | null;
  engine: string;
  rating: number | null;
  ai?: { model: string; level: number; effort: ArenaAiEffort | null } | null;
}

/** What an AI player's turn came to: its reason, the replies the harness refused, and the cost. */
export interface ArenaAiNote {
  reason: string;
  plan?: string;
  tries: number;
  /** The harness picked a move for it after too many refused replies. */
  rescued: boolean;
  /** US dollars. */
  cost: number;
  tokens: number;
  seconds: number;
  errors?: string[];
}

export interface ArenaMoveNote {
  opening?: boolean;
  book?: BookHit;
  slip?: boolean;
  eval?: { cp: number | null; mate: number | null };
  /** The judge's grade for the move, as game analysis grades (arena.grade_move). */
  grade?: Omit<MoveGrade, 'accuracy'> & { accuracy?: number };
  ai?: ArenaAiNote;
}

/** Graded moves per player: arena.GRADES. */
export type ArenaTally = Partial<Record<Grade, number>>;

export interface ArenaGame {
  number: number;
  /** Which player (0 or 1) had White. */
  white: 0 | 1;
  result: string;
  termination: string;
  opening: string | null;
  plies: number;
  eco?: string; openingName?: string;
  moves?: string[];
  /** Moves each player made from their own games (legends). */
  book: [number, number];
  grades?: [ArenaTally, ArenaTally];
  /** How many of `moves` were played before this match, when it continued a game. */
  continued?: number;
  /** Per ply, what the AI player said and spent (null on the other player's moves); only in AI games. */
  ai?: (ArenaAiNote | null)[];
}

export interface ArenaSettings {
  games: number;
  movetime: number;
  openings: 'start' | 'varied' | 'book';
  pace: 'watch' | 'fast';
  /** Stop as soon as the result is statistically decided (arena.sprt_llr); true uses the defaults. */
  sprt?: boolean | { elo0?: number; elo1?: number; alpha?: number; beta?: number } | null;
  /** Stop the match once the AI players have spent this many dollars between them. */
  costCap?: number | null;
  /** UCI moves the game continued from (an AI game cut short and picked up again). */
  startMoves?: string[];
}
/** The sequential probability ratio test after the latest game; verdict H1 = the first player is stronger. */
export interface ArenaSprt { llr: number; lower: number; upper: number; elo0: number; elo1: number; verdict: 'H1' | 'H0' | null }
/** Book openings carry their ECO code and name; `opening` is then the line itself. */
export interface ArenaBookOpening { eco?: string; openingName?: string }

export interface ArenaMatch {
  id: string;
  date: string;
  players: [ArenaPlayer, ArenaPlayer];
  phase: 'preparing' | 'playing' | 'done';
  settings: ArenaSettings;
  score: [number, number];
  /** Graded moves per player across the match (matches saved before grading have none). */
  grades?: [ArenaTally, ArenaTally];
  games: ArenaGame[];
  current: {
    number: number;
    white: 0 | 1;
    opening: string | null;
    eco?: string; openingName?: string;
    moves: Move[];
    notes: ArenaMoveNote[];
    board: BoardState;
    lastMove: string | null;
    evals: [ArenaMoveNote['eval'] | null, ArenaMoveNote['eval'] | null];
    /** Full-strength Stockfish's score for White, for the eval bar; null once the game is over. */
    judge?: { cp: number | null; mate: number | null } | null;
  } | null;
  error: string | null;
  stopped: boolean;
  elo_diff?: number | null;
  /** True when the SPRT ended the match before its last game. */
  early?: boolean;
  sprt?: ArenaSprt | null;
  /** Dollars each AI player has spent (0 for an engine or a legend). */
  cost?: [number, number];
  /** True when the cost cap ended the match. */
  capped?: boolean;
}

export interface ArenaSummary {
  id: string;
  date: string;
  players: [ArenaPlayer, ArenaPlayer];
  score: [number, number];
  games_played: number;
  elo_diff: number | null;
  stopped: boolean;
  early?: boolean;
  sprt?: ArenaSprt | null;
  settings: ArenaSettings;
  cost?: [number, number];
  capped?: boolean;
}

/** GET /api/arena */
export interface ArenaStatus {
  running: boolean;
  match: ArenaMatch | null;
  recent: ArenaSummary[];
}

/** One row of error counts from game_stats.py (a phase, a move bucket, a think-time bucket). */
export interface StatsRow {
  bucket?: string; moves: number; inaccuracy: number; mistake: number; blunder: number;
  error_rate: number | null; blunder_rate: number | null; acpl: number | null; accuracy?: number | null; games?: number;
}
export interface StatsWdl { games: number; wins: number; draws: number; losses: number; score_pct: number | null }
/** /api/stats: the analytics game_stats.build_stats() makes from the archive. */
export interface GameStatsData {
  counts: { games: number; analyzed: number; timed_games: number };
  accuracy: Partial<Record<'opening' | 'middlegame' | 'endgame' | 'overall', StatsRow>>;
  heatmap: { bucket_size: number; by_move: StatsRow[]; peak: string | null };
  time: { timed_moves: number; by_think_time: StatsRow[]; by_clock: StatsRow[] };
  tilt: { recommendation: { break_after_losses: number | null; text: string | null } };
  performance: { by_rating: Partial<Record<string, StatsWdl>> };
  summary: { weaknesses: string[]; facts: string[] };
  motifs?: MotifStats;
}

/** One tactic from motifs.py: how often, the puzzle theme that trains it, and recent games where it happened. */
export interface MotifRow {
  tag: string; slug: string | null; count: number;
  /** Per 10 games, the newest analyzed games against the ones before; null with too few games. */
  trend?: { recent: number; earlier: number; direction: 'better' | 'worse' | null } | null;
  examples: { game_id: string | number; ply: number; fen: string; date?: string | null; opponent?: string | null }[];
}
export interface MotifStats { errors: number; games?: number; missed: MotifRow[]; allowed: MotifRow[] }

/** /api/arena/ladder: ratings fitted over every Arena game (ladder.py). */
export interface ArenaLadderData {
  players: { id: string; name: string; nominal: number | null; rating: number; ci_low: number; ci_high: number;
    games: number; points: number; score: number; wins: number; draws: number; losses: number;
    group: number; placed_by: 'anchor' | 'nominal' | 'average';
    /** An AI player: its model, help level and effort, and its spend over cost_games games. */
    ai: { model: string; level: number; effort: ArenaAiEffort | null } | null; cost?: number; cost_games?: number }[];
  groups: number; games: number; anchor: string | null;
}
