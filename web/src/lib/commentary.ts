// The coach's spoken commentary on a reviewed game: what to say about a move ("Blunder! The best move was
// knight takes on f5, with check.") and about the whole game (the recap). Everything said is built
// from the fixed lines in commentary.json, each one recorded on its own by narrate.py, which expands
// every {{placeholder}} over its whole domain (every square, every percent, every move number...).
// A result is a list of those lines, played back to back, so no sentence is ever synthesized live.
import i18n from '../i18n';
import english from '../i18n/locales/en/commentary.json';
import { startPly } from './format';
import { WIN_CEILING_CP, winPct } from './grades';
import type { BoardState, Color, Grade, Move } from '../types';

export type PieceName = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

const PIECES: Record<string, PieceName> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

/** The recorded range of each numeric placeholder; a number outside it has no recording, so it is not said. */
export const DOMAINS: Record<string, number[]> = english._domains;

const t = (key: string, values?: Record<string, string | number>) => i18n.t(`commentary:${key}`, values ?? {});
/** A domain is [low, high] or [low, high, step]: only those values were recorded. */
const inDomain = (name: string, n: number) => Number.isInteger(n) && n >= DOMAINS[name][0] && n <= DOMAINS[name][1]
  && (n - DOMAINS[name][0]) % (DOMAINS[name][2] ?? 1) === 0;
// Lines are drawn like cards from a shuffled deck: none comes back until the rest of its pool has
// been said, and a fresh deck never starts with the line said last.
const decks = new Map<string, number[]>();
const lastSaid = new Map<string, number>();
let random = Math.random;

/**
 * One line from a pool in commentary.json, without repeating until the pool is used up. The deck
 * holds positions in the pool, so a line with a placeholder ("This is the {{opening}}.") rotates
 * the same way whatever value fills it.
 */
function pick(key: string, values?: Record<string, string | number>): string {
  const pool = i18n.t(`commentary:${key}`, { returnObjects: true, ...values }) as unknown;
  if (typeof pool === 'string') return pool;
  if (!Array.isArray(pool) || !pool.length) return '';
  const id = `${i18n.language}:${key}`;
  let deck = decks.get(id);
  if (!deck?.length) deck = pool.map((_, i) => i).filter(i => pool.length < 2 || i !== lastSaid.get(id));
  const at = deck.splice(Math.floor(random() * deck.length), 1)[0];
  decks.set(id, deck);
  lastSaid.set(id, at);
  return String(pool[at] ?? pool[0]);
}

/** Start every pool afresh, optionally with a fixed random source (tests). */
export function resetVariety(source: () => number = Math.random) {
  decks.clear();
  lastSaid.clear();
  random = source;
}

/** A counted line ("One blunder." / "3 blunders."), or null when the count has no recording. */
function counted(key: string, name: string, n: number): string | null {
  if (n === 1) return t(`${key}.1`);
  return inDomain(name, n) ? t(`${key}.other`, { [name]: n }) : null;
}

/** "knight takes on f5", "with check": a SAN move in words, as recorded fragments. */
export function moveWords(san: string): string[] {
  const clean = san.replace(/[!?]+$/, '');
  const parts: string[] = [];
  if (clean.startsWith('O-O-O')) parts.push(t('move.castleLong'));
  else if (clean.startsWith('O-O')) parts.push(t('move.castleShort'));
  else {
    const square = clean.match(/([a-h][1-8])(?:=[NBRQ])?[+#]?$/)?.[1];
    if (!square) return [];
    const piece = /^[NBRQK]/.test(clean) ? PIECES[clean[0].toLowerCase()] : 'pawn';
    parts.push(t(`move.${clean.includes('x') ? 'takes' : 'to'}.${piece}`, { square }));
    const promotion = clean.match(/=([NBRQ])/)?.[1];
    if (promotion) parts.push(t(`move.promote.${PIECES[promotion.toLowerCase()]}`));
  }
  if (clean.endsWith('#')) parts.push(t('move.mate'));
  else if (clean.endsWith('+')) parts.push(t('move.check'));
  return parts;
}

/** "12 seconds", "3 minutes": how long a move took, or null when it has no recording. */
export function durationWords(seconds: number): string | null {
  const whole = Math.round(seconds);
  if (whole < 60) return counted('clock.seconds', 'seconds', Math.max(1, whole));
  return counted('clock.minutes', 'minutes', Math.round(whole / 60));
}

export interface Capture { piece: PieceName; mover: Color; free: boolean }

/**
 * What a move captured, and whether it was free: nothing of the losing side can take back on the
 * square. A king only counts as a defender when the capturing piece is unprotected.
 */
export function captureOf(before: BoardState, after: BoardState, uci: string): Capture | null {
  const from = uci.slice(0, 2), to = uci.slice(2, 4);
  const moving = before.pieces[from];
  if (!moving) return null;
  let taken = before.pieces[to];
  // En passant: the pawn moved diagonally onto an empty square, beside the pawn it took.
  if (!taken && moving.toLowerCase() === 'p' && from[0] !== to[0]) taken = before.pieces[`${to[0]}${from[1]}`];
  const piece = taken ? PIECES[taken.toLowerCase()] : undefined;
  if (!piece || piece === 'king') return null;
  const mover: Color = moving === moving.toUpperCase() ? 'white' : 'black';
  const control = after.control?.[to];
  if (!control) return { piece, mover, free: false };
  const supported = control[mover].length > 0;
  const recaptures = control[mover === 'white' ? 'black' : 'white']
    .filter(square => after.pieces[square]?.toLowerCase() !== 'k' || !supported);
  return { piece, mover, free: recaptures.length === 0 };
}

/** What a move did, in a word the coach can say instead of its grade ("Developing the knight."). */
export type Theme =
  | { kind: 'castleShort' | 'castleLong' | 'mate' | 'recapture' | 'openFile' | 'passedPawn' | 'center' | 'fork' | 'earlyQueen' | 'kingWalk' | 'kingCenter' | 'checkAgain' }
  | { kind: 'promote' | 'trade' | 'takes' | 'check' | 'develop' | 'forkKing' | 'attacks' | 'tempo' | 'pin' | 'pinKing'; piece: PieceName };

const HOMES: Record<string, string[]> = { N: ['b1', 'g1'], B: ['c1', 'f1'], n: ['b8', 'g8'], b: ['c8', 'f8'] };
const FILES = 'abcdefgh';
const VALUE: Record<PieceName, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 };
const colorOf = (piece: string): Color => (piece === piece.toUpperCase() ? 'white' : 'black');
const EARLY_QUEEN = 16; // plies: a queen move this early is worth a word
const KING_CENTER_MOVE = 12; // the move at which an uncastled king is pointed out

/**
 * What the piece now on `to` attacks that matters: the king, and any piece worth more than it or left
 * undefended (pawns aside), most valuable first.
 */
function targetsOf(board: BoardState, to: string): PieceName[] {
  const moving = board.pieces[to];
  if (!moving) return [];
  const mover = colorOf(moving), enemy = mover === 'white' ? 'black' : 'white', own = VALUE[PIECES[moving.toLowerCase()]];
  return Object.entries(board.pieces)
    .filter(([square, piece]) => colorOf(piece) === enemy && board.control?.[square]?.[mover].includes(to))
    .map(([square, piece]) => ({ piece: PIECES[piece.toLowerCase()], defended: (board.control?.[square]?.[enemy].length ?? 0) > 0 }))
    .filter(({ piece, defended }) => piece === 'king' || (piece !== 'pawn' && (!defended || VALUE[piece] > own)))
    .map(({ piece }) => piece)
    .sort((a, b) => VALUE[b] - VALUE[a]);
}

const DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]], LINES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const RAYS: Record<string, number[][]> = { b: DIAGONALS, r: LINES, q: [...DIAGONALS, ...LINES] };

/**
 * A pin the piece now on `to` makes: along one of its lines, an enemy piece (not a pawn) with the
 * enemy king behind it (an absolute pin) or something worth more. Null when it pins nothing.
 */
function pinOf(board: BoardState, to: string): Theme | null {
  const moving = board.pieces[to];
  const rays = moving ? RAYS[moving.toLowerCase()] : undefined;
  if (!moving || !rays) return null;
  const mover = colorOf(moving);
  for (const [df, dr] of rays) {
    const hit: string[] = [];
    let file = FILES.indexOf(to[0]) + df, rank = Number(to[1]) + dr;
    while (file >= 0 && file < 8 && rank >= 1 && rank <= 8 && hit.length < 2) {
      const piece = board.pieces[`${FILES[file]}${rank}`];
      if (piece) {
        if (colorOf(piece) === mover) break;
        hit.push(piece);
      }
      file += df;
      rank += dr;
    }
    if (hit.length < 2) continue;
    const [front, back] = hit.map(piece => PIECES[piece.toLowerCase()]);
    if (front === 'pawn' || front === 'king') continue;
    if (back === 'king') return { kind: 'pinKing', piece: front };
    if (VALUE[back] > VALUE[front]) return { kind: 'pin', piece: front };
  }
  return null;
}

/**
 * The piece a sound move gives up: the moving piece lands where something cheaper can take it, or
 * where nothing guards it, for less than it is worth. Meant for moves the engine approves of.
 */
export function sacrificeOf(before: BoardState, after: BoardState, uci: string): PieceName | null {
  const from = uci.slice(0, 2), to = uci.slice(2, 4);
  const moving = before.pieces[from], landed = after.pieces[to];
  if (!moving || !landed) return null;
  const side = colorOf(moving), piece = PIECES[landed.toLowerCase()];
  if (piece === 'king') return null;
  const taken = before.pieces[to] ? VALUE[PIECES[before.pieces[to].toLowerCase()]] : 0;
  const control = after.control?.[to];
  const attackers = (control?.[side === 'white' ? 'black' : 'white'] ?? []).map(square => VALUE[PIECES[after.pieces[square]?.toLowerCase() ?? 'k']]);
  if (!attackers.length || VALUE[piece] - taken < 1) return null;
  const guarded = (control?.[side].length ?? 0) > 0;
  const cheapest = Math.min(...attackers);
  if (guarded && (cheapest >= VALUE[piece] || cheapest === VALUE.king)) return null;
  return piece;
}

/** Whether `side`'s piece on `square` is attacked and has no defender. */
const hanging = (board: BoardState, square: string, side: Color) => {
  const control = board.control?.[square];
  return !!control && control[side === 'white' ? 'black' : 'white'].length > 0 && control[side].length === 0;
};

/**
 * The most valuable piece of the mover's (pawns and king aside) that the move leaves hanging and that
 * was not hanging before it: the reason a slip is a slip, when it is that simple.
 */
export function hangsOf(before: BoardState, after: BoardState, uci: string): PieceName | null {
  return hangsAt(before, after, uci)?.piece ?? null;
}

/** hangsOf, with the square the piece stands on. */
export function hangsAt(before: BoardState, after: BoardState, uci: string): { piece: PieceName; square: string } | null {
  const from = uci.slice(0, 2), to = uci.slice(2, 4);
  const moving = before.pieces[from];
  if (!moving) return null;
  const side = colorOf(moving);
  let worst: { piece: PieceName; square: string } | null = null;
  for (const [square, piece] of Object.entries(after.pieces)) {
    const name = PIECES[piece.toLowerCase()];
    if (colorOf(piece) !== side || name === 'pawn' || name === 'king' || !hanging(after, square, side)) continue;
    if (hanging(before, square === to ? from : square, side) && before.pieces[square === to ? from : square] === piece) continue;
    if (!worst || VALUE[name] > VALUE[worst.piece]) worst = { piece: name, square };
  }
  return worst;
}

/** Whether the pawn on `square` has no enemy pawn ahead of it on its own or a neighbouring file. */
function passed(board: BoardState, square: string, white: boolean): boolean {
  const file = FILES.indexOf(square[0]), rank = Number(square[1]);
  const enemy = white ? 'p' : 'P';
  return !Object.entries(board.pieces).some(([at, piece]) => piece === enemy
    && Math.abs(FILES.indexOf(at[0]) - file) <= 1 && (white ? Number(at[1]) > rank : Number(at[1]) < rank));
}

/**
 * The most telling thing a move did, or null for a quiet one, one theme per move in this order: a
 * promotion, mate, castling, a recapture, a trade, a capture, a fork, a check, developing a minor
 * piece (with tempo when it attacks), an attack on a piece, an early queen, a king walk, a rook on an
 * open file, a passed pawn on the march, a pawn into the center, an uncastled king at move 12.
 * `ply` is the move's place in the game (1 = White's first move from the standard start).
 */
export function themeOf(san: string, uci: string, before: BoardState, after: BoardState, previous?: Move, ply?: number, ownPrevious?: Move): Theme | null {
  const clean = san.replace(/[!?]+$/, '');
  const from = uci.slice(0, 2), to = uci.slice(2, 4);
  const moving = before.pieces[from];
  if (!moving) return null;
  const white = moving === moving.toUpperCase(), type = moving.toLowerCase();
  const promotion = clean.match(/=([NBRQ])/)?.[1];
  if (promotion) return { kind: 'promote', piece: PIECES[promotion.toLowerCase()] };
  if (clean.endsWith('#')) return { kind: 'mate' };
  if (clean.startsWith('O-O-O')) return { kind: 'castleLong' };
  if (clean.startsWith('O-O')) return { kind: 'castleShort' };
  if (clean.includes('x')) {
    if (previous?.san.includes('x') && previous.uci.slice(2, 4) === to) return { kind: 'recapture' };
    const taken = captureOf(before, after, uci);
    if (taken) return { kind: taken.piece === PIECES[type] ? 'trade' : 'takes', piece: taken.piece };
  }
  const targets = targetsOf(after, to);
  if (targets.length >= 2) {
    const other = targets.find(piece => piece !== 'king');
    return targets[0] === 'king' && other ? { kind: 'forkKing', piece: other } : { kind: 'fork' };
  }
  if (clean.endsWith('+')) return ownPrevious?.san.replace(/[!?]+$/, '').endsWith('+') ? { kind: 'checkAgain' } : { kind: 'check', piece: PIECES[type] };
  const pin = pinOf(after, to);
  if (pin) return pin;
  if (HOMES[moving]?.includes(from)) return { kind: targets.length ? 'tempo' : 'develop', piece: PIECES[type] };
  if (targets.length && targets[0] !== 'king') return { kind: 'attacks', piece: targets[0] };
  if (type === 'q' && ply != null && ply <= EARLY_QUEEN) return { kind: 'earlyQueen' };
  if (type === 'k' && Object.values(after.pieces).includes('Q') && Object.values(after.pieces).includes('q')) return { kind: 'kingWalk' };
  if (type === 'r' && from[0] !== to[0] && !Object.entries(after.pieces).some(([at, piece]) => at[0] === to[0] && piece.toLowerCase() === 'p')) {
    return { kind: 'openFile' };
  }
  if (type === 'p') {
    const rank = Number(to[1]);
    if ((white ? rank >= 5 : rank <= 4) && passed(after, to, white)) return { kind: 'passedPawn' };
    if (['d4', 'e4', 'd5', 'e5'].includes(to) && Number(from[1]) === (white ? 2 : 7)) return { kind: 'center' };
  }
  if (ply != null && Math.ceil(ply / 2) === KING_CENTER_MOVE && after.pieces[white ? 'e1' : 'e8'] === (white ? 'K' : 'k')) return { kind: 'kingCenter' };
  return null;
}

/** The line for a theme, drawn from its pool. */
const describe = (theme: Theme) => pick('piece' in theme ? `describe.${theme.kind}.${theme.piece}` : `describe.${theme.kind}`);

const SLIPS: Grade[] = ['inaccuracy', 'miss', 'mistake', 'blunder'];
/** A miss costs like a mistake: the better move is said, even in the highlights. */
const COSTLY: Grade[] = ['miss', 'mistake', 'blunder'];
/** Grades said out loud on their own; good, excellent, best and book moves speak only through what they did.
 *  A forced move is named outside the highlights, before what it did. */
const SPOKEN: Grade[] = ['brilliant', 'great', 'inaccuracy', 'miss', 'mistake', 'blunder'];
const LONG_THINK = 30; // seconds: a think worth remarking on, when the time control is unknown
const FAST_MOVE = 3; // seconds: too quick for a move that loses something
const SEEABLE_MATE = 5; // a missed mate longer than this is the engine's find, not the player's miss

export interface MoveReview {
  san: string;
  grade: Grade;
  capture?: Capture | null;
  /** What the move did (themeOf), said in place of a quiet grade. */
  theme?: Theme | null;
  /** A piece the move leaves hanging (hangsOf): the reason given for a slip. */
  hangs?: PieceName | null;
  /** How the move turned the evaluation (evalEventOf). */
  evalEvent?: EvalEvent | null;
  /** The mover's clock running low with this move (clockEventOf). */
  clockEvent?: 'lowMinute' | 'lowSeconds' | null;
  /** Whether White made the move, to tell a swing for the mover from one against them. */
  moverWhite?: boolean;
  /** The move before was a mistake or blunder too: the slip is handed right back. */
  answersSlip?: boolean;
  /** The game's first capture, after a long stretch without one. */
  firstCapture?: boolean;
  /** The game's result, on its last move. */
  result?: string | null;
  /** The piece a sound move gives up (sacrificeOf); said for good moves only. */
  sacrifice?: PieceName | null;
  /** How many times the position after the move came before: once is a repeat, twice a threefold. */
  repetition?: number;
  /** The engine's choice in the position before, when it is not the move played. */
  bestSan?: string | null;
  /** Mate in this many was there before the move, and the move let it go. */
  missedMate?: number | null;
  /** The opening's name, on the move that reaches it. */
  opening?: string | null;
  /** The first move after the opening book. */
  outOfBook?: boolean;
  /** How long the move took, when the game recorded clocks. */
  thinkSeconds?: number | null;
  /** Seconds that count as a long think in this game (longThink()). */
  longThink?: number;
}

/** The swings big enough for the highlights: a side starts winning, the game turns, a win slips, mate. */
const BIG_SWINGS: EvalEvent['kind'][] = ['winning', 'flipped', 'slipAway', 'mate'];

/**
 * What the coach says about one reviewed move, as recorded lines in speaking order. Slips, great and
 * brilliant moves are named; a good, best or book move is said only through what it did ("Trading
 * queens."), and a quiet one with nothing to tell is not said at all. Lines are drawn fresh on each
 * call, so call this when speaking, not when rendering.
 *
 * `brief` is the highlights, for a game played through on its own: mistakes and blunders with the
 * move that was better, great and brilliant moves, sacrifices, free pieces, mate and big swings, the
 * opening's name and the result. Inaccuracies, quiet moves, the clock and asides are left out.
 */
export function reviewLines(move: MoveReview, brief = false): string[] {
  const lines: string[] = [];
  const slipped = SLIPS.includes(move.grade), costly = COSTLY.includes(move.grade);
  const named = brief ? SPOKEN.filter(grade => grade !== 'inaccuracy') : SPOKEN;
  const full = !brief;
  if (move.opening) lines.push(pick('opening', { opening: move.opening }));
  if (full && move.outOfBook) lines.push(pick('outOfBook'));
  if (named.includes(move.grade) || (full && move.grade === 'forced')) lines.push(pick(`grade.${move.grade}`));
  if (costly && move.answersSlip) lines.push(pick('momentum.blunderBack'));
  if (full && move.firstCapture) lines.push(pick('momentum.firstCapture'));
  // A sound move that gives up material is a sacrifice, named even after "Brilliant!".
  const sacrifice = !slipped && !move.capture?.free ? move.sacrifice : null;
  if (move.capture?.free) lines.push(pick(`${costly ? 'poisoned' : 'free'}.${move.capture.piece}`));
  else if (sacrifice) {
    // A rook given for a knight or bishop is the exchange sacrifice, a named idea of its own.
    const exchange = sacrifice === 'rook' && (move.capture?.piece === 'knight' || move.capture?.piece === 'bishop');
    lines.push(pick(exchange ? 'describe.exchangeSac' : `describe.sacrifice.${sacrifice}`));
  }
  // The highlights keep only the moves that end or decide something: mate and promotion.
  else if (!SPOKEN.includes(move.grade) && move.theme && (full || move.theme.kind === 'mate' || move.theme.kind === 'promote')) {
    lines.push(describe(move.theme));
  }
  if (full && slipped && move.hangs) lines.push(pick(`reason.hangs.${move.hangs}`));
  // A slip that hands over a mere edge is already told by its grade; any bigger swing is said.
  const swing = move.evalEvent;
  const sayswing = swing && !(slipped && swing.kind === 'better') && (full || BIG_SWINGS.includes(swing.kind));
  if (swing && sayswing) lines.push(pick('side' in swing ? `eval.${swing.kind}.${swing.side}` : `eval.${swing.kind}`));
  // A missed mate is worth pointing out when a player could have seen it.
  const missedMate = move.missedMate && move.missedMate <= SEEABLE_MATE ? move.missedMate : null;
  if (missedMate) {
    const mate = counted('missedMate', 'mate', missedMate);
    if (mate) lines.push(mate);
  }
  if (((full ? slipped : costly) || missedMate) && move.bestSan && move.bestSan !== move.san) {
    const words = moveWords(move.bestSan);
    if (words.length) lines.push(pick('better'), ...words);
  }
  if (full) {
    const think = move.thinkSeconds;
    // A swing against the mover (the other side starts winning or gets mate, a win slips): no "worth it".
    const against = !!swing && (swing.kind === 'slipAway' || ('side' in swing && swing.kind !== 'better' && (swing.side === 'white') !== move.moverWhite));
    if (think != null) {
      const took = durationWords(think);
      // A long think is worth a word when it found something, or when it still lost something.
      if (think >= (move.longThink ?? LONG_THINK) && took && (costly || (!slipped && !against))) lines.push(pick('clock.tookYou'), took, pick(costly ? 'clock.stillWrong' : 'clock.worthIt'));
      else if (think <= FAST_MOVE && costly) lines.push(pick('clock.fastWrong'));
    }
    if (move.clockEvent) lines.push(pick(`clock.${move.clockEvent}`));
  }
  if (move.repetition && (full || move.repetition >= 2)) lines.push(pick(move.repetition >= 2 ? 'momentum.threefold' : 'momentum.repeat'));
  const end = move.result === '1-0' ? 'white' : move.result === '0-1' ? 'black' : move.result === '1/2-1/2' ? 'draw' : null;
  if (end) lines.push(pick(`end.${end}`));
  return lines.filter(Boolean);
}

/** An opening's family, as spoken: "Sicilian Defense" for "Sicilian Defense: Najdorf Variation". */
export const openingFamily = (name: string) => name.split(/[:,]/)[0].trim();

/** Seconds each move took, from the clocks left after it (PGN [%clk]) and the time control's increment. */
export function thinkTimes(moves: Move[], timeControl?: string): (number | null)[] {
  const [base, increment] = (timeControl ?? '').split('+').map(Number);
  return moves.map((move, i) => {
    const left = move.clock, before = i >= 2 ? moves[i - 2].clock : Number.isFinite(base) && base > 0 ? base : undefined;
    if (left == null || before == null) return null;
    const spent = before - left + (Number.isFinite(increment) ? increment : 0);
    return spent >= 0 ? spent : null;
  });
}

/** What counts as a long think: 4% of the starting clock (24 s at 10 minutes), between 15 s and 2 minutes. */
export function longThink(timeControl?: string): number {
  const base = Number((timeControl ?? '').split('+')[0]);
  return Number.isFinite(base) && base > 0 ? Math.min(120, Math.max(15, Math.round(base * 0.04))) : LONG_THINK;
}

type Eval = [number | null, number | null] | { cp: number | null; mate: number | null } | null;
const CEILING = WIN_CEILING_CP;
/** A White-POV eval for one side, mates beyond any centipawns, capped. */
function forSide(value: Eval, white: boolean): number | null {
  if (!value) return null;
  const [cp, mate] = Array.isArray(value) ? value : [value.cp, value.mate];
  const score = mate != null ? (mate > 0 ? CEILING : -CEILING) : cp == null ? null : Math.max(-CEILING, Math.min(CEILING, cp));
  return score == null ? null : white ? score : -score;
}

/** A turn in the evaluation a move caused, said once as it happens. */
export type EvalEvent = { kind: 'winning' | 'better' | 'flipped' | 'mate'; side: Color } | { kind: 'equal' | 'slipAway' };

const WINNING = 300, BETTER = 100, LEVEL = 50, CLEAR = 150; // centipawns

const mateOf = (value: Eval) => (!value ? null : Array.isArray(value) ? value[1] : value.mate);

/**
 * How a move changed the evaluation (White's view before and after it), in order of importance: a
 * forced mate appears, the game turns around, the mover lets a win slip, a side starts winning,
 * the game is level again, a side gets the better of it. Null when nothing crossed a line.
 * `earlier` is the evaluation a move before `before`: the engine can flicker between a mate score
 * and a big centipawn score, and a mate already announced there is not announced again.
 */
export function evalEventOf(before: Eval, after: Eval, moverWhite: boolean, earlier?: Eval): EvalEvent | null {
  const b = forSide(before, true), a = forSide(after, true);
  if (b == null || a == null) return null;
  const side = (score: number): Color => (score > 0 ? 'white' : 'black');
  const mate = mateOf(after), seen = [mateOf(before), mateOf(earlier ?? null)];
  if (mate != null && mate !== 0 && !seen.some(m => m != null && Math.sign(m) === Math.sign(mate))) {
    return { kind: 'mate', side: mate > 0 ? 'white' : 'black' };
  }
  if (mate != null) return null;
  if (Math.abs(b) >= CLEAR && Math.abs(a) >= CLEAR && Math.sign(a) !== Math.sign(b)) return { kind: 'flipped', side: side(a) };
  const sign = moverWhite ? 1 : -1;
  if (b * sign >= WINNING && a * sign <= BETTER) return { kind: 'slipAway' };
  if (Math.abs(a) >= WINNING && Math.abs(b) < WINNING) return { kind: 'winning', side: side(a) };
  if (Math.abs(a) < LEVEL && Math.abs(b) >= CLEAR) return { kind: 'equal' };
  if (Math.abs(a) >= BETTER && Math.abs(b) < BETTER) return { kind: 'better', side: side(a) };
  return null;
}

/** The mover's clock dropping under a minute or under ten seconds with this move, or null. */
export function clockEventOf(left?: number | null, before?: number | null): 'lowMinute' | 'lowSeconds' | null {
  if (left == null || before == null) return null;
  if (left < 10 && before >= 10) return 'lowSeconds';
  if (left < 60 && before >= 60) return 'lowMinute';
  return null;
}

export type Outcome = 'won' | 'lost' | 'drew';
export type Swing = { kind: 'comeback' | 'collapse' | 'slippedToDraw' | 'saved'; move: number } | { kind: 'control' };

const SWING = 300; // centipawns: clearly winning or losing
const STEADY = -100; // never worse than this: in control all game

/** The story of the evaluation: a comeback, a collapse, a save, or control from start to finish. */
export function swingOf(evals: Eval[], you: Color, outcome: Outcome, initialFen: string): Swing | null {
  const scores = evals.map(value => forSide(value, you === 'white'));
  // The last position is the result itself (mate, or a resignation scored as one): the story is before it.
  let worst = -1, best = -1;
  scores.slice(0, -1).forEach((score, i) => {
    if (score == null || i === 0) return;
    if (worst < 0 || score < scores[worst]!) worst = i;
    if (best < 0 || score > scores[best]!) best = i;
  });
  if (worst < 0) return null;
  const moveAt = (ply: number) => Math.floor((startPly(initialFen) + ply - 1) / 2) + 1;
  const low = scores[worst]!, high = scores[best]!;
  if (outcome === 'won') return low <= -SWING ? { kind: 'comeback', move: moveAt(worst) } : low > STEADY ? { kind: 'control' } : null;
  if (outcome === 'lost') return high >= SWING ? { kind: 'collapse', move: moveAt(best) } : null;
  if (high >= SWING) return { kind: 'slippedToDraw', move: moveAt(best) };
  return low <= -SWING ? { kind: 'saved', move: moveAt(worst) } : null;
}

/** The game's shape in one label, from White's win% over the game (storyOf). */
export type Story = 'oneBlunder' | 'backAndForth' | 'control' | 'closeFinish' | 'balanced';
const STORY_MIN = 10; // positions: a shorter game has no story to tell
const DECISIVE = 30; // win% points: one move that swings the game this much decides it
const CHOPPY = 6; // win% points: an average swing this big is a back-and-forth game
const AHEAD = 60; // win%: a side this far ahead is in front...
const IN_CONTROL = 0.7; // ...and in control when it was there for this share of the game
const CLOSE = 15; // win% points from even at the end: a close finish

/**
 * The story of a game from its evaluations, without AI: decided by one blunder (a single swing of 30
 * win% or more), back and forth (several such swings, or a big average swing), in control (the
 * winner ahead for more than 70% of the game), a close finish (ending near level), or balanced.
 * `winner` is the side that won, 'draw', or null when unknown; control is only the winner's story.
 */
export function storyOf(evals: Eval[], winner: Color | 'draw' | null): Story | null {
  const wins = evals.map(value => forSide(value, true)).filter((cp): cp is number => cp != null).map(winPct);
  if (wins.length < STORY_MIN) return null;
  const swings = wins.slice(1).map((win, i) => Math.abs(win - wins[i]));
  const decisive = swings.filter(swing => swing >= DECISIVE).length;
  if (decisive === 1) return 'oneBlunder';
  if (decisive > 1 || swings.reduce((sum, swing) => sum + swing, 0) / swings.length >= CHOPPY) return 'backAndForth';
  const share = (side: Color) => wins.filter(win => (side === 'white' ? win : 100 - win) >= AHEAD).length / wins.length;
  const leader = (['white', 'black'] as const).find(side => share(side) > IN_CONTROL);
  if (leader && (winner == null || winner === leader)) return 'control';
  return Math.abs(wins[wins.length - 1] - 50) <= CLOSE ? 'closeFinish' : 'balanced';
}

/** The story's line for this game, one of a few phrasings picked the same way every time for the same `key` (the game). */
export function storyLine(story: Story, outcome: Outcome | null, key: string): string {
  const pool = i18n.t(`commentary:story.${story}.${outcome ?? 'none'}`, { returnObjects: true }) as unknown;
  if (!Array.isArray(pool) || !pool.length) return typeof pool === 'string' ? pool : '';
  let hash = 0;
  for (const char of `${key}:${story}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return String(pool[hash % pool.length]);
}

export interface GameRecap {
  outcome: Outcome | null;
  swing?: Swing | null;
  /** The game's story (storyOf) and the line for it (storyLine), said when no swing is. */
  story?: string | null;
  accuracy?: number | null;
  counts?: Partial<Record<Grade, number>>;
  /** Your longest think: how long, on which move number, and whether the move held up. */
  longestThink?: { seconds: number; move: number; good: boolean } | null;
  /** Seconds that count as a long think in this game (longThink()). */
  longThink?: number;
  /** The game's estimated ratings (game_rating.py), yours and your opponent's. */
  rating?: { you: number | null; opp: number | null } | null;
}

/** The spoken summary of a finished game, as recorded lines in speaking order. */
export function recapLines(recap: GameRecap): string[] {
  const lines: string[] = [];
  if (recap.outcome) lines.push(t(`recap.${recap.outcome}`));
  const swing = recap.swing;
  if (swing) {
    if (swing.kind === 'control') lines.push(t('recap.control'));
    else if (inDomain('move', swing.move)) lines.push(t(`recap.${swing.kind}`, { move: swing.move }));
  } else if (recap.story) lines.push(recap.story);
  if (recap.accuracy != null && inDomain('percent', Math.round(recap.accuracy))) lines.push(t('recap.accuracy', { percent: Math.round(recap.accuracy) }));
  const counts = recap.counts;
  if (counts) {
    for (const grade of ['brilliant', 'mistake'] as const) {
      const line = counts[grade] ? counted(`recap.${grade}`, 'count', counts[grade]!) : null;
      if (line) lines.push(line);
    }
    const blunders = counts.blunder ?? 0;
    const line = blunders ? counted('recap.blunder', 'count', blunders) : t('recap.noBlunders');
    if (line) lines.push(line);
  }
  // "You played like 1650. Your opponent played like 1400." (game_rating.py's estimate, rounded to 50).
  for (const [side, key] of [['you', 'recap.rating'], ['opp', 'recap.oppRating']] as const) {
    const rating = recap.rating?.[side];
    if (rating != null && inDomain('rating', rating)) lines.push(t(key, { rating }));
  }
  const think = recap.longestThink;
  const took = think && think.seconds >= (recap.longThink ?? LONG_THINK) ? durationWords(think.seconds) : null;
  if (think && took && inDomain('move', think.move)) {
    lines.push(t('recap.longestThink'), took, t('recap.onMove', { move: think.move }), t(think.good ? 'recap.paidOff' : 'recap.didNotPayOff'));
  }
  return lines.filter(Boolean);
}

/** The play-along coach's line for a capture: yours ("Free knight!") or theirs ("You left your rook hanging."). */
export function captureLine(capture: Capture, you: Color): string {
  const mine = capture.mover === you;
  return pick(`live.${mine ? (capture.free ? 'free' : 'took') : (capture.free ? 'hung' : 'lost')}.${capture.piece}`);
}
