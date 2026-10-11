import { describe, expect, it } from 'vitest';
import { STORY_BIOMES } from './art';
import { chapterScenery, columnsFor, pathLayout, scaleFor, trailPath } from './storyScenery';

describe('pathLayout', () => {
  it('winds left to right, then back, row by row', () => {
    const { points, rows, cols } = pathLayout(10, 900);
    expect(cols).toBe(4);
    expect(rows).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2]);
    // Row 0 runs rightward, row 1 leftward, and each row turns where the last one ended.
    expect(points[1][0]).toBeGreaterThan(points[0][0]);
    expect(points[5][0]).toBeLessThan(points[4][0]);
    expect(points[4][0]).toBeCloseTo(points[3][0]);
    expect(points[4][1]).toBeGreaterThan(points[3][1]);
  });

  it('uses fewer columns on narrow maps', () => {
    expect([columnsFor(900), columnsFor(600), columnsFor(400)]).toEqual([4, 3, 2]);
  });

  it('grows rows, gutters and the edge band on wide maps, up to a limit', () => {
    expect([scaleFor(700), scaleFor(860), scaleFor(1204), scaleFor(3000)]).toEqual([1, 1, 1.4, 1.45]);
    const narrow = pathLayout(8, 860);
    const wide = pathLayout(8, 1204);
    expect(wide.rowHeight).toBeGreaterThan(narrow.rowHeight);
    expect(wide.gutter).toBeGreaterThan(narrow.gutter);
    expect(wide.edgeBand).toBe(Math.round(150 * 1.4));
    expect(wide.height).toBeGreaterThan(narrow.height);
  });

  it('draws one trail segment per step', () => {
    const layout = pathLayout(6, 900);
    expect(trailPath(layout).match(/C/g)).toHaveLength(5);
    expect(trailPath(layout, 2, 4).match(/C/g)).toHaveLength(2);
  });
});

describe('chapterScenery', () => {
  const layout = pathLayout(14, 900);

  it('is the same on every call', () => {
    expect(chapterScenery('first-moves', STORY_BIOMES.basics, layout)).toEqual(chapterScenery('first-moves', STORY_BIOMES.basics, layout));
  });

  it('keeps gutter scenery on the side the path does not turn through', () => {
    const gutters = chapterScenery('the-immortals', STORY_BIOMES.history, layout).filter(d => d.kind === 'tree' || d.kind === 'landmark');
    // Row 0 turns on the right, so the band below it is free on the left; then they alternate.
    expect(gutters.map(d => d.side)).toEqual(['left', 'right', 'left']);
    expect(gutters[0].kind).toBe('landmark');
  });

  it('puts one edge scene on the side away from the last node, mirrored when on the right', () => {
    const edges = chapterScenery('opening-ideas', STORY_BIOMES.openings, layout).filter(d => d.kind === 'edge');
    expect(edges).toHaveLength(1);
    const last = layout.points[layout.points.length - 1];
    expect(edges[0].side).toBe(last[0] > layout.width / 2 ? 'left' : 'right');
    expect(edges[0].flip).toBe(edges[0].side === 'right');
  });
});
