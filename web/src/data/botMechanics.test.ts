import { BOT_MECHANICS, fire, freshState, momentsOf, stalkVolume, type BotMechanics } from './botMechanics';
import { boardAfter } from '../test/harness';

const mechanics: BotMechanics = {
  events: [
    { on: 'botCheck', say: 'check!' },
    { on: 'botMove', every: 2, say: 'every other move' },
    { on: 'botCapture', chance: 0.5, say: 'half the time' },
    { on: 'start', once: true, say: 'hello' },
    { on: 'yourMove', fromMove: 10, say: 'late' },
  ],
};

test('a move makes its most specific moments first', () => {
  expect(momentsOf('Qxf7+', true)).toEqual(['botCheck', 'botCapture', 'botMove']);
  expect(momentsOf('e4', false)).toEqual(['yourMove']);
});

test('the first event that fires wins, by its moment, count, chance and move number', () => {
  const state = freshState();
  expect(fire(mechanics, momentsOf('Qxf7+', true), 5, state)?.say).toBe('check!');
  // A plain bot move: the 2nd one fires 'every: 2' (the check above counted as the 1st).
  expect(fire(mechanics, ['botMove'], 6, state)?.say).toBe('every other move');
  expect(fire(mechanics, ['botMove'], 7, state)).toBeNull();
  expect(fire(mechanics, ['botCapture'], 8, state, () => 0.9)).toBeNull();
  expect(fire(mechanics, ['botCapture'], 8, state, () => 0.1)?.say).toBe('half the time');
  expect(fire(mechanics, ['yourMove'], 9, state)).toBeNull();
  expect(fire(mechanics, ['yourMove'], 10, state)?.say).toBe('late');
  expect(fire(mechanics, ['start'], 1, state)?.say).toBe('hello');
  expect(fire(mechanics, ['start'], 1, state)).toBeNull();  // once
});

test("El Silbón's whistle is loud while he is far from your king and faint once he closes in", () => {
  const far = boardAfter([]);
  const near = { ...far, pieces: { ...far.pieces }, control: { e1: { white: [], black: ['d3', 'h4'] }, d2: { white: [], black: ['b4', 'c3'] }, f2: { white: [], black: ['h4', 'c5'] } } };
  expect(stalkVolume(far, 'white')).toBe(1);
  expect(stalkVolume(near, 'white')).toBeLessThan(0.2);
  expect(BOT_MECHANICS['el-silbo-n'].events.some(event => event.sound?.volume === 'stalk')).toBe(true);
});
