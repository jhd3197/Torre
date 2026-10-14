import { GRADES, GRADE_INFO, emptyGrades, gradeIcon, gradeLine, gradeOf, judge, marked } from './grades';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const move = (over: object) => ({ ply: 1, san: 'e4', class: null, best: false, brilliant: false, accuracy: 90, ...over });

test('grades come from the review flags, brilliant first', () => {
  expect(gradeOf(move({ brilliant: true, best: true }))).toBe('brilliant');
  expect(gradeOf(move({ class: 'blunder' }))).toBe('blunder');
  expect(gradeOf(move({ best: true }))).toBe('best');
  expect(gradeOf(move({}))).toBe('good');
  expect(gradeOf(move({ excellent: true }))).toBe('excellent');
  expect(gradeOf(move({ class: 'inaccuracy', miss: true }))).toBe('miss');
  expect(gradeOf(move({ forced: true, best: true }))).toBe('forced');
});

test('a good move is the quiet default; the rest get a mark', () => {
  expect(marked('good')).toBe(false);
  expect(marked('best')).toBe(true);
  expect(GRADE_INFO.blunder.symbol).toBe('??');
});

test('every grade has artwork and translated copy in both languages', async () => {
  const { default: i18n } = await import('../i18n');
  expect(GRADES).toHaveLength(11);
  for (const grade of GRADES) {
    expect(existsSync(resolve('public', gradeIcon(grade)))).toBe(true);
    for (const lng of ['en', 'es']) {
      expect(i18n.exists(`board:grades.${grade}.label`, { lng })).toBe(true);
      expect(i18n.exists(`arena:tally.${grade}`, { lng })).toBe(true);
      expect(i18n.exists(`insights:quality.${grade}`, { lng })).toBe(true);
      expect(i18n.exists(`games:game.gradeTable.${grade}`, { lng })).toBe(true);
    }
  }
});

test('server grades survive the browser review and count exclusively', () => {
  const flags = [
    { brilliant: true, best: true }, { great: true, best: true }, { best: true }, {},
    { book: true, best: true }, { class: 'inaccuracy' }, { class: 'mistake' }, { class: 'blunder', book: true },
    { excellent: true }, { forced: true }, { class: 'inaccuracy', miss: true },
  ];
  const evaluations = [{ cp: 0, mate: null, best: null }, ...flags.map(f => ({ cp: 0, mate: null, best: null, grade: move(f) }))];
  const line = flags.map(() => ({ uci: 'a2a3', san: 'a3' }));
  const counts = emptyGrades();
  for (const m of gradeLine(line, evaluations, true).values()) counts[gradeOf(m)]++;
  expect(Object.values(counts)).toEqual(Array(11).fill(1));
});

test('review evaluations are judged with the Lichess thresholds, from the mover’s side', () => {
  const at = (cp: number) => ({ cp, mate: null, best: null });
  expect(judge(at(30), at(-400), true)).toBe('blunder');
  expect(judge(at(30), at(-400), false)).toBeNull(); // Black just improved
  expect(judge(at(0), { cp: null, mate: -2, best: null }, true)).toBe('blunder'); // walked into a mate
  const graded = gradeLine([{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }],
    [{ cp: 20, mate: null, best: 'e2e4' }, at(20), at(160)], true);
  expect(graded.get(1)).toMatchObject({ best: true, class: null });
  expect(graded.get(2)?.class).toBe('mistake');
});

test('without the server grade the browser still finds excellent moves and misses', () => {
  const at = (cp: number, best: string | null = null) => ({ cp, mate: null, best });
  const line = [{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }, { uci: 'g1f3', san: 'Nf3' }];
  const graded = gradeLine(line, [at(20, 'd2d4'), at(18), at(400, 'd2d4'), at(250)], true);
  expect(gradeOf(graded.get(1)!)).toBe('excellent');
  expect(gradeOf(graded.get(2)!)).toBe('blunder');
  expect(gradeOf(graded.get(3)!)).toBe('miss');
});
