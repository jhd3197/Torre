import { describe, expect, test } from 'vitest';
import { DRILL_PIECES, distances, makeDrill, nextMove, reach, squareIndex, squareName, starRoute, whyNot, type DrillLayout, type Occupants } from './drills';

const occupants = (layout: DrillLayout): Occupants => ({ own: new Set(layout.own), enemies: layout.enemies });

/** Play a route on the layout, checking every move is one the piece can make. */
function playRoute(layout: DrillLayout) {
  let at = layout.from;
  for (const [from, to] of layout.route) {
    expect(from).toBe(at);
    expect(reach(layout.piece, from, occupants(layout))).toContain(to);
    at = to;
  }
  return at;
}

describe('piece moves', () => {
  test('a rook slides until it meets a piece: it stops before its own and takes an enemy', () => {
    const board: Occupants = { own: new Set([squareIndex('b4')]), enemies: { [squareIndex('e6')]: 'p' } };
    const squares = reach('R', squareIndex('e4'), board).map(squareName).sort();
    expect(squares).toEqual(['c4', 'd4', 'e1', 'e2', 'e3', 'e5', 'e6', 'f4', 'g4', 'h4'].sort());
  });

  test('a knight jumps over pieces in the way', () => {
    const board: Occupants = { own: new Set([squareIndex('b1'), squareIndex('a2'), squareIndex('b2')]), enemies: {} };
    expect(reach('N', squareIndex('a1'), board).map(squareName).sort()).toEqual(['b3', 'c2']);
  });

  test('a refused square says why: own piece, wrong pattern, or blocked', () => {
    const board: Occupants = { own: new Set([squareIndex('a4')]), enemies: {} };
    const from = squareIndex('a1');
    expect(whyNot('R', from, squareIndex('a4'), board)).toBe('own');
    expect(whyNot('R', from, squareIndex('b2'), board)).toBe('pattern');
    expect(whyNot('R', from, squareIndex('a6'), board)).toBe('blocked');
  });

  test('the star route lands on every star in the fewest moves', () => {
    const board: Occupants = { own: new Set(), enemies: {} };
    const { par, route } = starRoute('R', squareIndex('a1'), ['a6', 'f6', 'f2'].map(squareIndex), board);
    expect(par).toBe(3);
    expect(route.map(([, to]) => squareName(to))).toEqual(['a6', 'f6', 'f2']);
  });

  test('the next-move hint heads for the nearest way around a blocker', () => {
    const board: Occupants = { own: new Set([squareIndex('a4'), squareIndex('c1')]), enemies: {} };
    const goal = squareIndex('d6');
    const before = distances('R', squareIndex('a1'), board).dist.get(goal)!;
    const step = nextMove('R', squareIndex('a1'), [goal], board)!;
    expect(before).toBe(3);
    expect(distances('R', step[1], board).dist.get(goal)).toBe(before - 1);
  });
});

describe('generated drills', () => {
  const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 1);

  test.each(DRILL_PIECES)('collect the stars with the %s: always solvable, and the par is the route', piece => {
    for (const seed of SEEDS) {
      const layout = makeDrill({ kind: 'stars', piece, stars: 3, blockers: 2 }, seed);
      expect(layout.stars).toHaveLength(3);
      expect(layout.par).toBe(layout.route.length);
      playRoute(layout);
      const landed = new Set(layout.route.map(([, to]) => to));
      for (const star of layout.stars) expect(landed.has(star)).toBe(true);
    }
  });

  test.each(DRILL_PIECES)('reach the flag with the %s: the flag is a real trip away', piece => {
    for (const seed of SEEDS) {
      const layout = makeDrill({ kind: 'reach', piece, blockers: 3, distance: 2 }, seed);
      expect(playRoute(layout)).toBe(layout.goal);
      expect(distances(piece, layout.from, occupants(layout)).dist.get(layout.goal!)).toBe(layout.par);
    }
  });

  test.each(DRILL_PIECES)('capture with the %s: exactly one enemy can be taken', piece => {
    for (const seed of SEEDS) {
      const layout = makeDrill({ kind: 'capture', piece, enemies: 3, blockers: 1 }, seed);
      const takes = reach(piece, layout.from, occupants(layout)).filter(i => layout.enemies[i]);
      expect(takes).toEqual([layout.goal]);
    }
  });

  test.each(DRILL_PIECES)('count with the %s: the answer is among three choices', piece => {
    for (const seed of SEEDS) {
      const layout = makeDrill({ kind: 'count', piece, blockers: 1, enemies: 1 }, seed);
      expect(layout.answer).toBe(reach(piece, layout.from, occupants(layout)).length);
      expect(layout.options).toContain(layout.answer);
      expect(new Set(layout.options).size).toBe(layout.options!.length);
      expect(layout.options!.length).toBeGreaterThanOrEqual(2);
    }
  });

  test.each(DRILL_PIECES)('a watched stars drill with the %s lands on a star with every move', piece => {
    for (const seed of SEEDS) {
      const layout = makeDrill({ kind: 'stars', piece, stars: 3, watch: true }, seed);
      expect(layout.par).toBe(3);
    }
  });

  test('a repeat is a different position with the same goal; the same seed is the same position', () => {
    const recipe = { kind: 'stars' as const, piece: 'R' as const, stars: 3 };
    const a = makeDrill(recipe, 1), b = makeDrill(recipe, 2);
    expect([a.from, ...a.stars]).not.toEqual([b.from, ...b.stars]);
    expect(b.stars).toHaveLength(a.stars.length);
    expect(makeDrill(recipe, 1)).toEqual(a);
  });
});
