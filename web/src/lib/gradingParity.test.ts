// The browser's review grades must match scoring.py's: both read content/grading.json, and
// grading-cases.json holds the Python side's answers (test_grade_parity.py checks them there).
import cases from './grading-cases.json';
import { chancesDrop, isMiss, judge, moveAccuracy, winPct, WIN_CEILING_CP } from './grades';
import { eloForNodes, nodesForElo } from './nodeStrength';

const ply = ([cp, mate]: (number | null)[]) => ({ cp, mate, best: null });
const capped = (cp: number | null, mate: number | null) =>
  mate != null ? Math.sign(mate) * WIN_CEILING_CP : Math.max(-WIN_CEILING_CP, Math.min(WIN_CEILING_CP, cp ?? 0));

test('move judgments match scoring.judge', () => {
  const answers = cases.judge.map(c => judge(ply(c.before), ply(c.after), c.white));
  expect(answers).toEqual(cases.judge.map(c => c.judgment));
});

test('misses and winning-chance drops match scoring.is_miss and chances_drop', () => {
  const answers = cases.isMiss.map(c => isMiss(c.earlier ? ply(c.earlier) : null, ply(c.before), ply(c.after), c.white));
  expect(answers).toEqual(cases.isMiss.map(c => c.miss));
  for (const c of cases.chancesDrop) expect(chancesDrop(ply(c.before), ply(c.after), c.white)).toBeCloseTo(c.drop, 9);
});

test('win% and move accuracy match scoring.py', () => {
  for (const c of cases.winPct) expect(winPct(capped(c.cp, c.mate))).toBeCloseTo(c.winPct, 9);
  for (const c of cases.moveAccuracy) expect(moveAccuracy(c.before, c.after)).toBeCloseTo(c.accuracy, 9);
});

test('node budgets and ratings match engines.py', () => {
  expect(cases.eloForNodes.map(c => eloForNodes(c.nodes))).toEqual(cases.eloForNodes.map(c => c.elo));
  expect(cases.nodesForElo.map(c => nodesForElo(c.elo))).toEqual(cases.nodesForElo.map(c => c.nodes));
});
