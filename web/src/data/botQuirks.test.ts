import { BOT_QUIRKS, styleFor } from './botQuirks';
import { ALL_BOTS, characterCollections } from './bots';

const characters = [...ALL_BOTS, ...characterCollections().themes.flatMap(theme => theme.bots),
  ...characterCollections().countries.flatMap(country => country.bots)];
const byId = new Map(characters.map(bot => [bot.id, bot]));

test('every quirk belongs to a character whose description promises it', () => {
  for (const id of Object.keys(BOT_QUIRKS)) expect(byId.has(id), id).toBe(true);
  expect(Object.keys(BOT_QUIRKS).length).toBeGreaterThanOrEqual(20);
});

test("a bot plays with its own quirk, else a light lean from its style, and engines and the coach with none", () => {
  expect(styleFor(byId.get('mila-the-mimic'))).toMatchObject({ quirk: 'mirror' });
  expect(styleFor(byId.get('diego-santos'))?.opening?.white).toEqual(['e4']);
  const wild = characters.find(bot => bot.avatar && !BOT_QUIRKS[bot.id] && bot.style[0] >= 80)!;
  expect(styleFor(wild)).toMatchObject({ quirk: 'aggressive', chance: 0.25 });
  expect(styleFor(ALL_BOTS.find(bot => bot.id === 'sf18'))).toBeUndefined();
  expect(styleFor(ALL_BOTS.find(bot => bot.coach))).toBeUndefined();
});
