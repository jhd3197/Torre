// The Story map's geometry: nodes wind left-to-right, then right-to-left, row
// by row (a serpentine), and a little scenery sits where the path leaves room.
// Everything is computed from the node count and the map's width, so the trail
// and the scenery line up without measuring the DOM; picks are seeded by the
// chapter, so the map looks the same on every visit.
import type { StoryBiome } from './art';

export type Side = 'left' | 'right';
export type Point = [number, number];

export interface PathLayout {
  cols: number; width: number; height: number;
  /** Node centres, in path order. */
  points: Point[];
  /** Row of each node (rows alternate direction). */
  rows: number[];
  rowHeight: number;
  /** The margin left and right of the columns, where the path turns. */
  gutter: number;
  /** How much larger than the 860px design everything is drawn (nodes, art, scenery); 1 on narrow maps. */
  scale: number;
  /** The band under the last row that the edge scene stands in. */
  edgeBand: number;
}

export const ROW_HEIGHT = 285;
const TOP = 86;
const EDGE_BAND = 150;
// A gentle wave across each row, by visual column, so rows do not look ruled.
const WAVE = [0, 16, 4, 22, 8];

/** Maps wider than the 860px design grow everything with them, up to this much. */
const MAX_SCALE = 1.45;
export const scaleFor = (width: number) => Math.min(MAX_SCALE, Math.max(1, width / 860));

/** A small deterministic hash: the same string always gives the same 0..1 number. */
export function seeded(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10007) / 10007;
}

const pick = <T,>(items: T[], r: number): T => items[Math.min(items.length - 1, Math.floor(r * items.length))];

export const columnsFor = (width: number) => (width >= 760 ? 4 : width >= 540 ? 3 : 2);

export function pathLayout(count: number, width: number): PathLayout {
  const cols = columnsFor(width);
  const scale = scaleFor(width);
  // Wide enough for a landmark to stand beside the path without touching a node.
  const gutter = width >= 540 ? Math.round(Math.max(74, width * 0.13)) : 36;
  const rowHeight = Math.round(ROW_HEIGHT * scale);
  const top = Math.round(TOP * scale);
  const edgeBand = Math.round(EDGE_BAND * scale);
  const colWidth = (width - 2 * gutter) / cols;
  const points: Point[] = [];
  const rows: number[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const step = i % cols;
    const col = row % 2 === 0 ? step : cols - 1 - step;
    points.push([gutter + (col + 0.5) * colWidth, top + row * rowHeight + WAVE[col % WAVE.length] * scale]);
    rows.push(row);
  }
  const rowCount = Math.max(1, Math.ceil(count / cols));
  return { cols, width, height: top + (rowCount - 1) * rowHeight + Math.round(190 * scale) + edgeBand, points, rows, rowHeight, gutter, scale, edgeBand };
}

/** The trail through the nodes: S-bends along a row, a wide loop through the gutter at each turn. */
export function trailPath(layout: PathLayout, from = 0, to = layout.points.length - 1): string {
  const { points, rows, gutter } = layout;
  let d = '';
  for (let i = from; i <= to; i++) {
    const [x, y] = points[i];
    if (i === from) { d += `M${x},${y}`; continue; }
    const [px, py] = points[i - 1];
    if (rows[i] === rows[i - 1]) {
      const half = (x - px) / 2;
      d += ` C${px + half},${py} ${x - half},${y} ${x},${y}`;
    } else {
      const out = (rows[i - 1] % 2 === 0 ? 1 : -1) * gutter * 0.95;
      const lift = (y - py) * 0.12;
      d += ` C${px + out},${py + lift} ${x + out},${y - lift} ${x},${y}`;
    }
  }
  return d;
}

export interface Decor {
  kind: 'tuft' | 'tree' | 'landmark' | 'edge';
  src: string;
  /** Where the decoration stands (bottom centre); edge scenes use `side` instead. */
  x: number; y: number;
  side: Side;
  flip: boolean;
}

/** A light dressing for one chapter: a tuft between some nodes, one thing in each free gutter, one edge scene. */
export function chapterScenery(chapterId: string, biome: StoryBiome, layout: PathLayout): Decor[] {
  const { points, rows, width, height, gutter, rowHeight } = layout;
  const r = (salt: string) => seeded(`${chapterId}:${salt}`);
  const out: Decor[] = [];
  // Tufts: above the trail between neighbours on a row, every other gap or so.
  for (let i = 1; i < points.length; i++) {
    if (rows[i] !== rows[i - 1] || r(`tuft${i}`) < 0.55) continue;
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    out.push({ kind: 'tuft', src: pick(biome.props, r(`tuftsrc${i}`)), x: (px + x) / 2, y: (py + y) / 2 - 44 * layout.scale, side: 'left', flip: r(`tuftflip${i}`) < 0.5 });
  }
  // Gutters: each turn uses one side, so the other side of that band is free.
  const rowCount = rows.length ? rows[rows.length - 1] + 1 : 0;
  if (width >= 540) {
    for (let row = 0; row < rowCount - 1; row++) {
      const side: Side = row % 2 === 0 ? 'left' : 'right';
      const y = points[row * layout.cols][1] + rowHeight * 0.62;
      const landmark = row === 0 ? biome.landmarks[0] : row === 2 ? biome.landmarks[1] : undefined;
      out.push({
        kind: landmark ? 'landmark' : 'tree', src: landmark ?? pick(biome.trees, r(`tree${row}`)),
        x: side === 'left' ? gutter * 0.55 : width - gutter * 0.55, y, side, flip: side === 'right',
      });
    }
  }
  // One edge scene in the band below the last row, on the side away from the last node.
  const last = points[points.length - 1];
  if (last && biome.edges.length) {
    const side: Side = last[0] > width / 2 ? 'left' : 'right';
    out.push({ kind: 'edge', src: pick(biome.edges, r('edge')), x: 0, y: height, side, flip: side === 'right' });
  }
  return out;
}
