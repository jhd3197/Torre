// Piece drills: the lesson steps that are little games on a bare board (collect the stars, reach
// the flag, capture the one piece you can reach, count the squares). A lesson stores the recipe
// (which piece, how many stars, how many blockers); the layout is made here, fresh each time the
// step opens, so a repeat is never the same position but always the same goal. Every layout is
// checked solvable before it is shown.
//
// Squares are 0..63 from a8 (0) to h1 (63), like the design: row = 8 - rank, col = file.

export type DrillPiece = 'R' | 'B' | 'Q' | 'N' | 'K';
export type DrillKind = 'stars' | 'reach' | 'capture' | 'count';

export const DRILL_PIECES: DrillPiece[] = ['R', 'B', 'Q', 'N', 'K'];

export interface DrillRecipe {
  kind: DrillKind;
  piece: DrillPiece;
  /** stars: how many to collect. */
  stars?: number;
  /** Your own pawns in the way. */
  blockers?: number;
  /** capture / count: black pieces on the board. */
  enemies?: number;
  /** reach: the fewest moves the flag takes. */
  distance?: number;
  /** stars: a demonstration, so each move should land on a star. */
  watch?: boolean;
}

export interface DrillLayout {
  piece: DrillPiece;
  /** Where your piece starts. */
  from: number;
  /** Your own pawns. */
  own: number[];
  /** Black pieces by square (lowercase FEN letters). */
  enemies: Record<number, string>;
  /** stars: squares to land on. */
  stars: number[];
  /** reach: the flag; capture: the piece to take. */
  goal: number | null;
  /** The fewest moves that finish the drill. */
  par: number;
  /** One shortest solution, as [from, to] moves (watching plays it). */
  route: [number, number][];
  /** count: the right answer and the choices offered. */
  answer?: number;
  options?: number[];
}

const FILES = 'abcdefgh';
export const squareName = (i: number) => FILES[i & 7] + (8 - (i >> 3));
export const squareIndex = (name: string) => (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]);
export const sameLine = (a: number, b: number) => (a >> 3) === (b >> 3) || (a & 7) === (b & 7);
export const sameDiagonal = (a: number, b: number) => Math.abs((a >> 3) - (b >> 3)) === Math.abs((a & 7) - (b & 7));

const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT_JUMPS = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const SLIDES: Record<DrillPiece, number[][]> = {
  R: ROOK_DIRS, B: BISHOP_DIRS, Q: [...ROOK_DIRS, ...BISHOP_DIRS], K: [...ROOK_DIRS, ...BISHOP_DIRS], N: KNIGHT_JUMPS,
};
const SLIDER: Record<DrillPiece, boolean> = { R: true, B: true, Q: true, K: false, N: false };

/** What stands on the board around the moving piece: your pawns and Black's pieces. */
export interface Occupants { own: Set<number>; enemies: Record<number, string> }

/**
 * Squares `piece` on `from` reaches in one move: it stops before your own pieces and on an enemy
 * (a capture). `empty` ignores everything on the board (how the piece moves at all).
 */
export function reach(piece: DrillPiece, from: number, board: Occupants, empty = false, only?: number[][]): number[] {
  const out: number[] = [];
  const r = from >> 3, c = from & 7;
  for (const [dr, dc] of only ?? SLIDES[piece]) {
    for (let k = 1; k < 8; k++) {
      const rr = r + dr * k, cc = c + dc * k;
      if (rr < 0 || rr > 7 || cc < 0 || cc > 7) break;
      const j = rr * 8 + cc;
      if (!empty && board.own.has(j)) break;
      out.push(j);
      if (!empty && board.enemies[j]) break;
      if (!SLIDER[piece]) break;
    }
  }
  return out;
}

/** The directions a piece slides in, for hints that show some lines at a time. */
export const lines = (piece: DrillPiece) => SLIDES[piece];

/** Moves from `from` to every square it can get to without capturing, and the first step there. */
export function distances(piece: DrillPiece, from: number, board: Occupants): { dist: Map<number, number>; prev: Map<number, number> } {
  const dist = new Map([[from, 0]]), prev = new Map<number, number>();
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of reach(piece, cur, board)) {
      if (dist.has(next)) continue;
      dist.set(next, dist.get(cur)! + 1);
      prev.set(next, cur);
      // An enemy square ends the trip: you can land on it but not pass it.
      if (!board.enemies[next]) queue.push(next);
    }
  }
  return { dist, prev };
}

/** The moves of a shortest trip from `from` to `to` (empty if it cannot be reached). */
export function path(piece: DrillPiece, from: number, to: number, board: Occupants): [number, number][] {
  const { prev } = distances(piece, from, board);
  if (from === to || !prev.has(to)) return [];
  const steps: [number, number][] = [];
  for (let at = to; at !== from; at = prev.get(at)!) steps.unshift([prev.get(at)!, at]);
  return steps;
}

/** The shortest way to land on every star, in the best order: [moves, route]. Stars are few
 *  (five at most), so every order is tried. */
export function starRoute(piece: DrillPiece, from: number, stars: number[], board: Occupants): { par: number; route: [number, number][] } {
  let best: { par: number; route: [number, number][] } = { par: Infinity, route: [] };
  const visit = (at: number, left: number[], route: [number, number][]) => {
    if (route.length >= best.par) return;
    if (!left.length) { best = { par: route.length, route }; return; }
    for (const star of left) {
      const leg = path(piece, at, star, board);
      if (leg.length) visit(star, left.filter(s => s !== star), [...route, ...leg]);
    }
  };
  visit(from, stars, []);
  return best;
}

/** The next move toward the nearest target, for the hint ladder (null when none is reachable). */
export function nextMove(piece: DrillPiece, from: number, targets: number[], board: Occupants): [number, number] | null {
  if (targets.length > 1) return starRoute(piece, from, targets, board).route[0] ?? null;
  return targets.length ? path(piece, from, targets[0], board)[0] ?? null : null;
}

/** The squares a sliding move passes over and lands on (just the landing square for a jump). */
export function between(piece: DrillPiece, from: number, to: number): number[] {
  if (!SLIDER[piece]) return [to];
  const out: number[] = [];
  const dr = Math.sign((to >> 3) - (from >> 3)), dc = Math.sign((to & 7) - (from & 7));
  for (let i = from; i !== to;) { i += dr * 8 + dc; out.push(i); }
  return out;
}

/** Why a tap is not a move: your own piece there, a square the piece never reaches in one move,
 *  or one it could reach on an empty board but something is in the way. */
export function whyNot(piece: DrillPiece, from: number, to: number, board: Occupants): 'own' | 'pattern' | 'blocked' {
  if (board.own.has(to)) return 'own';
  return reach(piece, from, board, true).includes(to) ? 'blocked' : 'pattern';
}

// ── Generating layouts ──

/** A small seeded random source (mulberry32), so a layout can be made again from its seed. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T,>(list: T[]) => list[Math.floor(next() * list.length)],
    shuffle: <T,>(list: T[]) => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
      return out;
    },
  };
}
type Rng = ReturnType<typeof seeded>;

const clamp = (value: number | undefined, fallback: number, low: number, high: number) =>
  Math.max(low, Math.min(high, Number.isInteger(value) ? value! : fallback));
const ENEMY_KINDS = ['p', 'n', 'b', 'r', 'q'];

/** Empty squares not in `taken`, shuffled. */
const free = (rng: Rng, taken: Iterable<number>) => {
  const used = new Set(taken);
  return rng.shuffle([...Array(64).keys()].filter(i => !used.has(i)));
};

/** A start square away from the very edge for the long-range pieces, anywhere for the rest. */
const startSquare = (rng: Rng, piece: DrillPiece) => {
  const inner = piece === 'N' || piece === 'K' ? 1 : 0;
  return (inner + rng.int(8 - 2 * inner)) * 8 + inner + rng.int(8 - 2 * inner);
};

function makeStars(rng: Rng, piece: DrillPiece, count: number, blockers: number): DrillLayout | null {
  const from = startSquare(rng, piece);
  const own = free(rng, [from]).slice(0, blockers);
  const board: Occupants = { own: new Set(own), enemies: {} };
  const { dist } = distances(piece, from, board);
  const reachable = [...dist.keys()].filter(i => i !== from);
  if (reachable.length < count) return null;
  // Not all in one move from the start: the drill is about chaining moves.
  const stars = rng.shuffle(reachable).slice(0, count);
  if (count > 1 && stars.every(s => dist.get(s) === 1)) return null;
  const { par, route } = starRoute(piece, from, stars, board);
  if (!Number.isFinite(par)) return null;
  return { piece, from, own, enemies: {}, stars, goal: null, par, route };
}

/** A demonstration: walk the piece a random route and drop a star on every landing, so each move
 *  of the shortest route grabs one. */
function makeWatchStars(rng: Rng, piece: DrillPiece, count: number, blockers: number): DrillLayout | null {
  const from = startSquare(rng, piece);
  const own = free(rng, [from]).slice(0, blockers);
  const board: Occupants = { own: new Set(own), enemies: {} };
  const route: [number, number][] = [];
  const seen = new Set([from]);
  let at = from;
  for (let i = 0; i < count; i++) {
    const options = reach(piece, at, board).filter(sq => !seen.has(sq));
    if (!options.length) return null;
    const to = rng.pick(options);
    route.push([at, to]);
    seen.add(to);
    at = to;
  }
  const stars = route.map(([, to]) => to);
  // A shorter way would skip a star per move; keep only walks that are already the best.
  if (starRoute(piece, from, stars, board).par < count) return null;
  return { piece, from, own, enemies: {}, stars, goal: null, par: count, route };
}

function makeReach(rng: Rng, piece: DrillPiece, blockers: number, distance: number): DrillLayout | null {
  const from = startSquare(rng, piece);
  const own = free(rng, [from]).slice(0, blockers);
  const board: Occupants = { own: new Set(own), enemies: {} };
  const { dist } = distances(piece, from, board);
  const far = [...dist.keys()].filter(i => dist.get(i) === distance);
  if (!far.length) return null;
  // Prefer a flag the piece would reach in one move on an empty board: the blockers are the lesson.
  const blocked = far.filter(i => reach(piece, from, board, true).includes(i));
  const goal = rng.pick(blocked.length && rng.next() < 0.7 ? blocked : far);
  const route = path(piece, from, goal, board);
  return { piece, from, own, enemies: {}, stars: [], goal, par: route.length, route };
}

function makeCapture(rng: Rng, piece: DrillPiece, enemies: number, blockers: number): DrillLayout | null {
  const from = startSquare(rng, piece);
  const spots = free(rng, [from]);
  const own = spots.slice(0, blockers);
  const placed: Record<number, string> = {};
  for (const sq of spots.slice(blockers, blockers + enemies)) placed[sq] = rng.pick(ENEMY_KINDS);
  const board: Occupants = { own: new Set(own), enemies: placed };
  const hits = reach(piece, from, board).filter(i => placed[i]);
  if (hits.length !== 1) return null;
  // At least one other enemy sits on a line the piece knows, but blocked: the near-miss to notice.
  const decoy = Object.keys(placed).map(Number).some(i => i !== hits[0] && reach(piece, from, board, true).includes(i));
  if (!decoy && piece !== 'N' && piece !== 'K') return null;
  return { piece, from, own, enemies: placed, stars: [], goal: hits[0], par: 1, route: [[from, hits[0]]] };
}

function makeCount(rng: Rng, piece: DrillPiece, blockers: number, enemies: number): DrillLayout | null {
  // Off the edge, so every direction has squares to count.
  const from = (1 + rng.int(6)) * 8 + 1 + rng.int(6);
  const lineSquares = rng.shuffle(reach(piece, from, { own: new Set(), enemies: {} }, true));
  // Put the blockers and enemies on the piece's own lines, so each one changes the count.
  if (lineSquares.length < blockers + enemies + 2) return null;
  const own = lineSquares.slice(0, blockers);
  const placed: Record<number, string> = {};
  for (const sq of lineSquares.slice(blockers, blockers + enemies)) placed[sq] = rng.pick(ENEMY_KINDS);
  const board: Occupants = { own: new Set(own), enemies: placed };
  const answer = reach(piece, from, board).length;
  if (answer < 2) return null;
  const emptyCount = reach(piece, from, board, true).length;
  const noCaptures = answer - Object.keys(placed).filter(i => reach(piece, from, board).includes(Number(i))).length;
  const near = [answer + 2, answer - 2, answer + 1, answer - 1, answer + 3];
  const wrong = [...new Set([emptyCount, noCaptures, ...near])].filter(n => n !== answer && n > 0);
  const options = [answer, ...wrong.slice(0, 2)].sort((a, b) => a - b);
  return { piece, from, own, enemies: placed, stars: [], goal: null, par: 0, route: [], answer, options };
}

/**
 * A fresh, solvable layout for the recipe. Tries the asked-for difficulty first, then eases it
 * (fewer blockers, a nearer flag) so a step always has a board.
 */
export function makeDrill(recipe: DrillRecipe, seed = Math.floor(Math.random() * 2 ** 31)): DrillLayout {
  const rng = seeded(seed);
  const piece = DRILL_PIECES.includes(recipe.piece) ? recipe.piece : 'R';
  const tries = (make: () => DrillLayout | null) => {
    for (let i = 0; i < 400; i++) { const layout = make(); if (layout) return layout; }
    return null;
  };
  switch (recipe.kind) {
    case 'stars': {
      const count = clamp(recipe.stars, 3, 1, 5);
      // A demonstration reads best when every move lands on a star.
      if (recipe.watch) {
        const layout = tries(() => makeWatchStars(rng, piece, count, clamp(recipe.blockers, 0, 0, 8)));
        if (layout) return layout;
      }
      for (let blockers = clamp(recipe.blockers, 0, 0, 8); blockers >= 0; blockers--) {
        const layout = tries(() => makeStars(rng, piece, count, blockers));
        if (layout) return layout;
      }
      break;
    }
    case 'reach': {
      for (let distance = clamp(recipe.distance, 2, 2, 4); distance >= 1; distance--) {
        for (let blockers = clamp(recipe.blockers, 3, 0, 10); blockers >= 0; blockers--) {
          const layout = tries(() => makeReach(rng, piece, blockers, distance));
          if (layout) return layout;
        }
      }
      break;
    }
    case 'capture': {
      for (let blockers = clamp(recipe.blockers, 1, 0, 6); blockers >= 0; blockers--) {
        const layout = tries(() => makeCapture(rng, piece, clamp(recipe.enemies, 3, 2, 4), blockers));
        if (layout) return layout;
      }
      break;
    }
    case 'count': {
      for (let blockers = clamp(recipe.blockers, 1, 0, 4); blockers >= 0; blockers--) {
        const layout = tries(() => makeCount(rng, piece, blockers, clamp(recipe.enemies, 1, 0, 3)));
        if (layout) return layout;
      }
      break;
    }
  }
  // Never reached for the pieces above; a last resort keeps the page standing.
  const from = 27;
  return { piece, from, own: [], enemies: {}, stars: [from - 8], goal: from - 8, par: 1, route: [[from, from - 8]], answer: 1, options: [1, 2, 3] };
}
