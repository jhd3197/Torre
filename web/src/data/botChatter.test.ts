import { CHAT_GAP, chatFor, chatLine, chatMoments, freshChat, swingOf, voiceFor, VOICES } from './botChatter';
import { ALL_BOTS } from './bots';
import { boardAfter } from '../test/harness';

test("a bot's voice comes from its tags and kind, else its rating and style", () => {
  expect(voiceFor(['legend', 'endgames'], 'legend', [50, 98, 98], 2600)).toBe('wise');
  // Wisdom needs the rating to back it.
  expect(voiceFor(['master'], 'master chef', [50, 30, 30], 700)).not.toBe('wise');
  expect(voiceFor(['gambits', 'initiative'], 'aggressive', [94, 58, 34], 1545)).toBe('cocky');
  expect(voiceFor(['fortress', 'patient'], 'defensive', [16, 70, 62], 1655)).toBe('grumpy');
  expect(voiceFor(['hangs pieces', 'forgiving'], 'comic', [50, 8, 8], 330)).toBe('nervous');
  expect(voiceFor(['cheerful', 'beginner'], 'kid', [48, 22, 18], 720)).toBe('nervous');
  expect(voiceFor(['vibes', 'casual'], 'chill', [56, 24, 22], 900)).toBe('friendly');
  expect(voiceFor(['quiet moves'], 'positional', [75, 56, 52], 1320)).toBe('cocky');
});

test('every character bot has a voice, and the roster uses all five', () => {
  const characters = ALL_BOTS.filter(bot => bot.avatar && !bot.coach);
  expect(characters.every(bot => bot.voice && VOICES.includes(bot.voice))).toBe(true);
  expect(new Set(characters.map(bot => bot.voice))).toEqual(new Set(VOICES));
});

test('a move makes its chatter moments, biggest first', () => {
  expect(chatMoments({ san: 'Qxf7+', uci: 'd1f7', byBot: true, swing: 400 })).toEqual(['youBlunder', 'botCheck', 'botCapture']);
  expect(chatMoments({ san: 'Nf3', uci: 'g1f3', byBot: true, swing: -260 })).toEqual(['youStrong']);
  expect(chatMoments({ san: 'Nf3', uci: 'g1f3', byBot: true, swing: 50 })).toEqual([]);
  // Your capture of the bot's rook or queen is a big piece lost; a pawn is not.
  const before = boardAfter([]);
  expect(chatMoments({ san: 'Bxa8', uci: 'g2a8', byBot: false, before })).toEqual(['lostBig']);
  expect(chatMoments({ san: 'Bxd7', uci: 'g2d7', byBot: false, before })).toEqual([]);
});

test("your move's swing compares the bot's read before its reply with its read after its last move", () => {
  expect(swingOf(20, 380)).toBe(360);
  expect(swingOf(20, -200)).toBe(-220);
  expect(swingOf(undefined, 380)).toBeNull();
  expect(swingOf(1500, 2500)).toBeNull();  // already decided
});

test('small talk is rationed; the big moments always get a line', () => {
  const state = freshChat();
  expect(chatFor(['botCheck'], 3, state, () => 0)).toBe('botCheck');
  expect(chatFor(['botCapture'], 3 + CHAT_GAP - 1, state, () => 0)).toBeNull();
  expect(chatFor(['youBlunder', 'botCapture'], 4, state, () => 0.99)).toBe('youBlunder');
  expect(chatFor(['botCapture'], 4 + CHAT_GAP, state, () => 0.99)).toBeNull();  // its chance missed
  expect(chatFor(['botCapture'], 4 + CHAT_GAP, state, () => 0)).toBe('botCapture');
  expect(chatFor(['draw'], 4 + CHAT_GAP + 1, state, () => 0.99)).toBe('draw');
});

test('a line comes from the voice and moment, the same for the same move', () => {
  expect(chatLine('grumpy', 'youBlunder', 0)).toBe('Sloppy.');
  expect(chatLine('wise', 'draw', 7)).toBe(chatLine('wise', 'draw', 7));
  for (const voice of VOICES) expect(chatLine(voice, 'draw', 1)).not.toBe('');
});
