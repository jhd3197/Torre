// Which illustration goes with which page, puzzle theme, lesson and insight (art/build_assets.py cuts them).
const topic = (name: string) => `art/topics/${name}.webp`;
const badge = (name: string) => `art/badges/${name}-color.webp`;

/** Progress illustrations shared by practice, lessons, and Insights. */
export const PROGRESS_ART = {
  target: 'art/progress/target.webp', calendar: 'art/progress/calendar.webp', study: 'art/progress/study.webp',
  victory: 'art/progress/victory.webp', growth: 'art/progress/growth.webp', clock: 'art/progress/clock.webp',
};

/** Page header art, by route title. */
export const PAGE_ART: Record<string, string> = {
  Play: topic('new-game'), Bots: topic('bots'), Games: topic('games'), Explore: topic('explore'), Train: topic('train'),
  Puzzles: badge('tactician'), Lessons: PROGRESS_ART.study, Story: 'art/story/hero-flag.webp', Insights: topic('insights'), Awards: 'art/ui3d/achievement.webp', Settings: 'art/ui3d/settings.webp',
  Coach: PROGRESS_ART.study, Profile: 'art/mascot/trophy.webp', Import: topic('import'), Engines: topic('analysis'), Arena: topic('bots'),
};

export const IMPORT_ART = topic('import');
export const ANALYSIS_ART = topic('analysis');

/** Puzzle themes; themes without art of their own share the closest one. */
export const PUZZLE_ART: Record<string, string> = {
  'from-your-games': PROGRESS_ART.target, storm: PROGRESS_ART.clock, streak: PROGRESS_ART.victory,
  'mate-in-1': topic('mate-in-1'), 'mate-in-2': topic('mate-in-2'), 'mate-in-3': topic('mate-in-3'), 'mate-in-4': topic('mate-in-3'),
  'back-rank-mate': badge('back-rank'), 'smothered-mate': topic('smothered-mate'), 'arabian-mate': topic('arabian-mate'),
  'anastasia-mate': topic('anastasia-mate'), 'boden-mate': topic('boden-mate'), 'hook-mate': topic('hook-mate'),
  fork: badge('fork'), pin: badge('pin'), skewer: badge('skewer'), 'discovered-attack': badge('discovery'),
  'double-check': topic('double-check'), 'x-ray': badge('skewer'), interference: badge('deflection'), clearance: badge('discovery'),
  'capturing-defender': topic('capture-defender'), 'exposed-king': topic('exposed-king'), 'kingside-attack': topic('kingside-attack'),
  'hanging-piece': topic('hanging-piece'), 'trapped-piece': topic('trapped-piece'), deflection: badge('deflection'),
  attraction: topic('attraction'), sacrifice: badge('sacrifice'), zwischenzug: topic('zwischenzug'), 'quiet-move': topic('quiet-move'),
  'defensive-move': topic('defensive-move'), promotion: badge('promotion'), underpromotion: topic('underpromotion'),
  'rook-endgame': topic('rook-endgame'), 'pawn-endgame': topic('pawn-endgame'),
  'bishop-endgame': topic('bishop-endgame'), 'knight-endgame': topic('knight-endgame'), 'queen-endgame': topic('queen-endgame'),
};

export const PUZZLE_RATING_ART = topic('rating');
export const PUZZLE_RETRY_ART = topic('retry');

/** Chess history: one emblem per champion, famous game and era. */
export const historyArt = (name: string) => `art/history/${name}.webp`;
export const HISTORY_NAMES = [
  'morphy', 'steinitz', 'lasker', 'capablanca', 'alekhine', 'botvinnik', 'tal', 'fischer', 'petrosian', 'spassky', 'karpov',
  'kasparov', 'kramnik', 'anand', 'carlsen', 'polgar', 'immortal-game', 'evergreen-game', 'game-of-the-century', 'the-turk',
  'romantic-era', 'hypermodern', 'soviet-school', 'engine-era',
] as const;

const figure = (piece: string) => `art/pieces/white-${piece}.webp`;
const opening = (name: string) => `art/openings/${name}.webp`;
/** Story scenes cut from the video sheets (art/source/video): a trap or plan acted out by the pieces. */
const storyMoment = (name: string) => `art/video/moment-${name}.webp`;

/** Lessons by slug, then by a whole word of the slug (a champion's name, a theme), then by unit, then a default. */
const LESSON_ART: Record<string, string> = {
  // Basics: the pieces themselves, then the rules.
  'the-rook': figure('rook'), 'the-bishop': figure('bishop'), 'the-queen': figure('queen'), 'the-knight': figure('knight'),
  'the-king': figure('king'), 'the-pawn': figure('pawn'), 'check-and-checkmate': badge('checkmate'), stalemate: topic('trapped-piece'),
  castling: badge('castle'), 'en-passant': topic('pawn-push'), 'promotion-basics': badge('promotion'), draws: topic('defensive-move'),
  // Openings: traps sit in the opening they come from.
  'opening-principles': topic('opening'), 'scholars-mate': opening('italian'), 'legals-mate': opening('philidor'),
  'fried-liver': opening('italian'), 'fishing-pole': opening('ruy-lopez'), 'englund-trap': opening('queens-pawn'),
  'lasker-trap': storyMoment('qg-lasker-trap'), 'elephant-trap': storyMoment('qg-elephant-trap'), 'noahs-ark-trap': opening('ruy-lopez'),
  'blackburne-shilling-trap': opening('italian'),
  // Tactics.
  'knight-fork': badge('fork'), pins: badge('pin'), 'discovered-attack': badge('discovery'), 'double-check': topic('double-check'),
  'removing-the-defender': topic('capture-defender'), deflection: badge('deflection'), attraction: topic('attraction'),
  overloading: topic('exposed-king'), interference: badge('discovery'), zwischenzug: topic('zwischenzug'), 'x-ray': badge('skewer'),
  'hanging-pieces': topic('hanging-piece'),
  // Checkmates.
  'back-rank-mate': badge('back-rank'), 'queen-mate': badge('checkmate'), 'rook-mate': topic('rook-endgame'),
  'two-bishops-mate': topic('bishop-endgame'), 'smothered-mate': topic('smothered-mate'), 'anastasias-mate': topic('anastasia-mate'),
  'arabian-mate': topic('arabian-mate'), 'bodens-mate': topic('boden-mate'), 'hook-mate': topic('hook-mate'), 'dovetail-mate': topic('queen-mate'),
  // Endgames.
  lucena: topic('bridge'), opposition: topic('opposition'), 'square-of-the-pawn': topic('pawn-endgame'),
  'king-and-pawn-vs-king': topic('pawn-endgame'), 'key-squares': topic('opposition'), 'outside-passed-pawn': badge('passed-pawn'),
  'pawn-breakthrough': topic('pawn-push'), triangulation: badge('zugzwang'), 'philidor-position': topic('rook-endgame'),
  'rook-behind-passed-pawn': topic('rook-endgame'), 'wrong-colored-bishop': topic('bishop-endgame'),
  // Strategy.
  'passed-pawns': badge('passed-pawn'), 'isolated-pawn': storyMoment('qg-isolated-pawn'), 'doubled-and-backward-pawns': figure('pawn'),
  'pawn-chains': figure('pawn'), outposts: badge('outpost'), 'open-files': figure('rook'), 'rook-on-the-seventh': topic('rook-endgame'),
  'good-and-bad-bishops': figure('bishop'), 'weak-squares-and-holes': historyArt('hypermodern'), prophylaxis: historyArt('petrosian'),
  // History.
  'morphy-opera-game': historyArt('morphy'), 'mikhail-tal': historyArt('tal'), 'the-immortal-game': historyArt('immortal-game'),
  'the-evergreen-game': historyArt('evergreen-game'),
};
const LESSON_WORDS: [RegExp, string][] = [
  ...HISTORY_NAMES.filter(name => !name.includes('-')).map(name => [new RegExp(`(^|-)${name}(-|$)`), historyArt(name)] as [RegExp, string]),
  [/(^|-)century(-|$)/, historyArt('game-of-the-century')], [/(^|-)immortal(-|$)/, historyArt('immortal-game')],
  [/(^|-)london(-|$)/, opening('london')], [/(^|-)colle(-|$)/, opening('colle')], [/(^|-)philidor(-|$)/, opening('philidor')],
  [/fork/, badge('fork')], [/(^|-)pins?(-|$)/, badge('pin')], [/skewer/, badge('skewer')], [/mate/, topic('mate-in-2')],
  [/endgame|ending/, topic('pawn-endgame')], [/opening/, topic('opening')], [/promot/, badge('promotion')], [/castl/, badge('castle')],
];
/** A series' emblem: the champion it is about, or its era. */
function unitArt(unit: string): string | undefined {
  const words = unit.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const champion = HISTORY_NAMES.find(name => !name.includes('-') && new RegExp(`\\b${name}\\b`).test(words));
  if (champion) return historyArt(champion);
  if (/romantic|tournament/.test(words)) return historyArt('romantic-era');
  if (/london|colle|philidor/.test(words)) return opening(words.match(/london|colle|philidor/)![0]);
  return undefined;
}
export const lessonArt = (slug: string, unit?: string | null) =>
  LESSON_ART[slug] ?? LESSON_WORDS.find(([pattern]) => pattern.test(slug))?.[1] ?? (unit ? unitArt(unit) : undefined) ?? badge('scholar');

/** Insights sections and game phases. */
export const INSIGHT_ART = {
  form: PROGRESS_ART.growth, phases: topic('middlegame'), colors: topic('as-white'), opponents: topic('bots'), recurring: topic('recurring'),
  mistakes: topic('mistakes'), opening: topic('opening'), middlegame: topic('middlegame'), endgame: topic('endgame'),
  white: topic('as-white'), black: topic('as-black'),
};

/** Opening illustrations: by name first (most specific words first), then by ECO family. */
const OPENING_WORDS: [RegExp, string][] = [
  [/trompowsky/i, 'trompowsky'], [/london/i, 'london'], [/colle/i, 'colle'], [/philidor/i, 'philidor'], [/french/i, 'french'],
  [/bird/i, 'bird'], [/italian|giuoco/i, 'italian'], [/king'?s gambit/i, 'kings-gambit'], [/queen'?s gambit/i, 'queens-gambit'],
  [/sicilian/i, 'sicilian'], [/caro/i, 'caro-kann'], [/ruy|spanish/i, 'ruy-lopez'], [/scandinavian|center counter/i, 'scandinavian'],
  [/dutch/i, 'dutch'], [/english/i, 'english'], [/pirc|modern/i, 'pirc'], [/king'?s indian/i, 'kings-indian'], [/slav/i, 'slav'],
  [/scotch/i, 'scotch'], [/vienna/i, 'vienna'], [/king'?s knight/i, 'kings-knight'],
  [/king'?s pawn/i, 'kings-pawn'], [/queen'?s pawn/i, 'queens-pawn'], [/uncommon|irregular/i, 'uncommon'],
];

/** The opening family an opening belongs to (its art and its story): by name first, then by ECO code. */
export function openingKey(name: string, eco: string): string {
  const named = OPENING_WORDS.find(([pattern]) => pattern.test(name))?.[1];
  const family = eco === 'A00' ? 'uncommon' : eco === 'D05' ? 'colle' : /^(A4|A5|D)/.test(eco) ? 'queens-pawn'
    : /^[BC]/.test(eco) ? 'kings-pawn' : 'uncommon';
  return named ?? family;
}

export const openingArt = (name: string, eco: string) => `art/openings/${openingKey(name, eco)}.webp`;

/** Story map scenery (art/build_assets.py story): one biome per chapter category. Trees group into
 *  clusters, props stand alone, landmarks mark a chapter's thirds and edge scenes hug the map's sides. */
const scene = (name: string) => `art/story/${name}.webp`;
export interface StoryBiome { trees: string[]; props: string[]; landmarks: string[]; edges: string[] }
const biome = (category: string, trees: string[], props: string[], landmarks: string[], edges = 2): StoryBiome => ({
  trees: trees.map(name => scene(`${category}/${name}`)), props: props.map(name => scene(`${category}/${name}`)),
  landmarks: landmarks.map(name => scene(`${category}/${name}`)),
  edges: Array.from({ length: edges }, (_, i) => scene(`${category}/edge-${i + 1}`)),
});
export const STORY_BIOMES: Record<string, StoryBiome> = {
  basics: biome('basics', ['tree', 'pine'], ['flowers', 'boulder', 'fence', 'mushrooms'], ['castle', 'bridge'], 1),
  checkmates: biome('checkmates', ['pine', 'dead-tree'], ['ferns', 'lantern', 'web', 'log'], ['tower', 'net']),
  openings: biome('openings', ['tree', 'sunflowers'], ['haystack', 'wheelbarrow', 'signpost', 'barrels'], ['windmill', 'cottage']),
  tactics: biome('tactics', ['cactus', 'spire'], ['tumbleweed', 'bush', 'crate', 'arch'], ['mesa', 'rope-bridge']),
  strategy: biome('strategy', ['bamboo', 'blossom', 'bonsai'], ['lantern', 'sand', 'pond'], ['pagoda', 'red-bridge']),
  endgames: biome('endgames', ['pine', 'ice-rock'], ['snowman', 'bush', 'sled', 'campfire'], ['peak', 'cabin']),
  history: biome('history', ['cypress', 'column'], ['laurel', 'amphora', 'tablet', 'rubble'], ['temple', 'archway']),
};
export const storyChapterArt = (chapterId: string) => scene(`chapter/${chapterId}`);
/** The home page's clay world (art/prompts/home.md): section islands and the pieces scattered around them. */
const home = (name: string) => `art/home/${name}.webp`;
export const HOME_ART = {
  puzzles: home('puzzles'), train: home('train'), bots: home('bots'), campfire: home('campfire'), break: home('break'), journey: home('journey'),
  cloudLong: home('cloud-long'), cloudPuff: home('cloud-puff'), balloon: home('balloon'), sun: home('sun'), moon: home('moon'),
  butterflies: home('butterflies'), paperPlane: home('paper-plane'), isletTree: home('islet-tree'), isletWaterfall: home('islet-waterfall'),
  kingBush: home('king-bush'), rookNap: home('rook-nap'), leaves: home('leaves'), picnic: home('picnic'),
  queenReading: home('queen-reading'), bishopTelescope: home('bishop-telescope'), leapfrog: home('leapfrog'), robot: home('robot'),
  knightSneak: home('knight-sneak'), pawnCloud: home('pawn-cloud'), tumbling: home('tumbling'),
};
export const STORY_ART = {
  hero: scene('hero-flag'), cheer: scene('hero-cheer'), quoteHill: scene('quote-hill'), gauntlet: scene('gauntlet'), bossGate: scene('boss-gate'),
  chest: scene('chest'), cloud: scene('cloud'), birds: scene('birds'), complete: scene('chapter/complete'),
};
