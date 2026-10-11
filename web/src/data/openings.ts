// The story behind each opening family: where the name comes from, the first moves, the idea,
// and the lessons that teach it. Keys match the opening art (art/openings/<key>.webp).

import { translatable } from '../i18n/content';

export interface OpeningStory {
  name: string;
  /** The defining first moves, in SAN. */
  moves: string;
  /** Where the name comes from: well-established history only. */
  origin: string;
  /** What the opening is trying to do, in one or two sentences. */
  idea: string;
  /** A lesson course on this opening, when there is one. */
  course?: string;
  /** A famous game in this opening that has a lesson. */
  game?: { lesson: string; label: string };
}

export const OPENING_STORIES: Record<string, OpeningStory> = {
  'queens-pawn': {
    name: "Queen's Pawn Game", moves: '1. d4',
    origin: 'Named for the pawn in front of the queen. Every opening that starts 1.d4 grows from it.',
    idea: 'The d4 pawn is protected by the queen from the start, so White claims the center without giving a target. Games tend to be slower and more strategic than after 1.e4.',
    course: 'london-setup',
  },
  'kings-pawn': {
    name: "King's Pawn Game", moves: '1. e4',
    origin: 'Named for the pawn in front of the king, the most popular first move in chess history.',
    idea: 'One move opens lines for the queen and the light-squared bishop and grabs the center. Expect open, tactical games.',
    course: 'opening-principles',
  },
  uncommon: {
    name: 'Uncommon Openings', moves: '1. a3, 1. g4, 1. Nh3 …',
    origin: 'A catch-all for first moves outside the main openings. Some have colorful names of their own, but none is common at master level.',
    idea: 'They avoid theory, but usually give the opponent the center for free. Answer them with simple development: take the center, bring out the pieces, castle.',
    course: 'opening-principles',
  },
  london: {
    name: 'London System', moves: '1. d4 d5 2. Bf4',
    origin: 'Named after the London tournament of 1922, where several masters used the setup.',
    idea: 'A system more than a line: d4, Bf4, e3, Nf3, c3 and Bd3 against almost anything. The bishop comes out before e3 locks it in.',
    course: 'london-setup',
  },
  colle: {
    name: 'Colle System', moves: '1. d4 d5 2. Nf3 Nf6 3. e3',
    origin: 'Named after Edgar Colle, a Belgian master of the 1920s who built his repertoire around it.',
    idea: 'A quiet setup with the bishop on d3 and the knight on d2, aiming for the e3–e4 break that opens lines toward the black king.',
    course: 'colle-setup',
  },
  trompowsky: {
    name: 'Trompowsky Attack', moves: '1. d4 Nf6 2. Bg5',
    origin: 'Named after the Brazilian master Octávio Trompowsky, who played it in the middle of the 20th century.',
    idea: 'The bishop goes straight to g5 to pin or trade off the f6 knight before Black settles into a familiar setup.',
  },
  'queens-gambit': {
    name: "Queen's Gambit", moves: '1. d4 d5 2. c4',
    origin: 'One of the oldest openings on record, analysed since the early days of modern chess.',
    idea: 'White offers the c-pawn to pull Black’s d-pawn away from the center. It is not a real gambit: White can almost always win the pawn back.',
  },
  slav: {
    name: 'Slav Defense', moves: '1. d4 d5 2. c4 c6',
    origin: 'Named after the many Slavic masters who developed it in the early 20th century.',
    idea: 'Black defends d5 with the c-pawn instead of the e-pawn, so the light-squared bishop can still come out to f5 or g4.',
  },
  dutch: {
    name: 'Dutch Defense', moves: '1. d4 f5',
    origin: 'Named after the Dutch player Elias Stein, who recommended it in a book at the end of the 18th century.',
    idea: 'Black fights for e4 with the f-pawn and often attacks on the kingside, at the price of a slightly looser king.',
  },
  'kings-indian': {
    name: "King's Indian Defense", moves: '1. d4 Nf6 2. c4 g6',
    origin: 'The "Indian" defences take their name from the 19th-century Indian player Moheschunder Bannerjee, who played fianchetto setups like this one. It became a top-level weapon in the mid-20th century.',
    idea: 'Black lets White build a big center, then attacks it, often with …e5 and a pawn storm on the kingside.',
  },
  english: {
    name: 'English Opening', moves: '1. c4',
    origin: 'Named after the English champion Howard Staunton, who played it in his famous 1843 match against Saint-Amant.',
    idea: 'White controls d5 from the side and keeps flexible: the game can turn into a reversed Sicilian or transpose into a 1.d4 opening.',
  },
  bird: {
    name: "Bird's Opening", moves: '1. f4',
    origin: 'Named after Henry Bird, an English master who kept playing it in the 19th century when almost nobody else did.',
    idea: 'White grabs e5 with the f-pawn, like a Dutch Defense with an extra move. The king is a little looser, so watch the e1–h4 diagonal.',
  },
  'kings-knight': {
    name: "King's Knight Opening", moves: '1. e4 e5 2. Nf3',
    origin: 'Named for the knight that develops with tempo against e5. Most of the classic open games start here.',
    idea: 'White develops and attacks the e5 pawn in one move. The Italian, the Ruy Lopez, the Scotch and the Philidor all begin from this position.',
    course: 'opening-principles',
  },
  philidor: {
    name: 'Philidor Defense', moves: '1. e4 e5 2. Nf3 d6',
    origin: 'Named after François-André Danican Philidor, the strongest player of the 18th century and also a celebrated opera composer.',
    idea: 'Black holds e5 with a pawn instead of a piece: solid, a little cramped, with the bishop on e7 and the c-pawn ready to support d5 later.',
    course: 'philidor-setup',
    game: { lesson: 'morphy-opera-game', label: 'Morphy’s Opera Game, Paris 1858' },
  },
  italian: {
    name: 'Italian Game', moves: '1. e4 e5 2. Nf3 Nc6 3. Bc4',
    origin: 'Named after the Italian masters of the 16th and 17th centuries, like Gioachino Greco, who analysed it. Its quiet main line is called the Giuoco Piano, "the quiet game".',
    idea: 'The bishop aims at f7, the weakest square next to the black king. Develop fast, castle, and prepare d4.',
    course: 'fried-liver',
  },
  'ruy-lopez': {
    name: 'Ruy Lopez', moves: '1. e4 e5 2. Nf3 Nc6 3. Bb5',
    origin: 'Named after Ruy López de Segura, a Spanish priest who wrote about it in a chess book in 1561. Also called the Spanish Game.',
    idea: 'The bishop attacks the knight that defends e5. The pressure lasts for many moves, which is why it has been a favourite of world champions for over a century.',
    course: 'noahs-ark-trap',
  },
  scotch: {
    name: 'Scotch Game', moves: '1. e4 e5 2. Nf3 Nc6 3. d4',
    origin: 'Named after a correspondence match between Edinburgh and London in 1824, where the Edinburgh team played it.',
    idea: 'White opens the center at once instead of building slowly. The pieces get free play, and Black must react accurately.',
  },
  'kings-gambit': {
    name: "King's Gambit", moves: '1. e4 e5 2. f4',
    origin: 'The favourite of the romantic era of the 19th century, when sacrifices and attack ruled the board.',
    idea: 'White offers the f-pawn to tear open the f-file and the center, accepting risk to the king for a fast attack.',
    game: { lesson: 'the-immortal-game', label: 'The Immortal Game, London 1851' },
  },
  vienna: {
    name: 'Vienna Game', moves: '1. e4 e5 2. Nc3',
    origin: 'Named after the Vienna players who developed it in the middle of the 19th century.',
    idea: 'White develops the queen’s knight first, keeping the option of f4 later, like a King’s Gambit with better preparation.',
  },
  sicilian: {
    name: 'Sicilian Defense', moves: '1. e4 c5',
    origin: 'Described by Italian authors as early as the late 1500s, and named after players from Sicily.',
    idea: 'Black fights for d4 from the side, creating an unbalanced game. It is the most popular reply to 1.e4 at master level, and the sharpest.',
  },
  french: {
    name: 'French Defense', moves: '1. e4 e6',
    origin: 'Named after a correspondence match between London and Paris in the 1830s, where the Paris team used it.',
    idea: 'Black prepares …d5 to challenge e4. The position is solid but the light-squared bishop is often stuck behind the e6 pawn.',
  },
  'caro-kann': {
    name: 'Caro-Kann Defense', moves: '1. e4 c6',
    origin: 'Named after Horatio Caro and Marcus Kann, who analysed it together in the 1880s.',
    idea: 'Like the French, Black prepares …d5, but with the c-pawn, so the light-squared bishop can still come out. Solid and hard to crack.',
    game: { lesson: 'mikhail-tal', label: 'Tal – Smyslov, 1959' },
  },
  scandinavian: {
    name: 'Scandinavian Defense', moves: '1. e4 d5',
    origin: 'Named after Scandinavian players who analysed it in the 19th century. Often cited as the opening of the oldest recorded chess game, from Valencia in 1475.',
    idea: 'Black challenges e4 at once. After 2.exd5 Qxd5 the queen comes out early, so Black must be ready to move it again.',
  },
  pirc: {
    name: 'Pirc Defense', moves: '1. e4 d6 2. d4 Nf6 3. Nc3 g6',
    origin: 'Named after Vasja Pirc, a Slovenian grandmaster of the 20th century. Its close cousin, 1…g6, is called the Modern Defense.',
    idea: 'Black lets White take the center, fianchettoes the bishop on g7, and strikes at the center later.',
  },
};

/** The story key for an opening art file name (art/openings/<key>.webp). */
for (const [key, story] of Object.entries(OPENING_STORIES)) {
  translatable(story, `openings.${key}`, ['name', 'origin', 'idea']);
  if (story.game) translatable(story.game, `openings.${key}.game`, ['label']);
}

export const storyFor = (key: string): OpeningStory | undefined => OPENING_STORIES[key];
