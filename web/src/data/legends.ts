// The Hall of Legends: each legend's clay figurine and era (art/build_assets.py cuts them from art/source/legends).
export type Era = 'romantic' | 'golden' | 'cold-war' | 'modern';

export const ERAS: Era[] = ['romantic', 'golden', 'cold-war', 'modern'];

/** masters.py ids (PGN Mentor file names) by era, oldest first within each. */
const ERA_MEMBERS: Record<Era, string[]> = {
  romantic: ['Philidor', 'DeLaBourdonnais', 'Anderssen', 'Morphy', 'Steinitz', 'Chigorin', 'Pillsbury', 'Marshall'],
  golden: ['Lasker', 'Rubinstein', 'Capablanca', 'Alekhine', 'Nimzowitsch', 'Reti', 'Tartakower', 'Euwe', 'Menchik', 'Keres',
    'Botvinnik', 'Smyslov', 'Bronstein', 'Najdorf'],
  'cold-war': ['Tal', 'Petrosian', 'Spassky', 'Fischer', 'Korchnoi', 'Larsen', 'Gaprindashvili', 'Karpov', 'Chiburdanidze',
    'Kasparov', 'PolgarS', 'PolgarJ'],
  modern: ['Kramnik', 'Anand', 'Topalov', 'Carlsen', 'Hou', 'Aronian', 'Caruana', 'Nakamura', 'So', 'Ding', 'Nepomniachtchi',
    'JuWenjun', 'Firouzja', 'Gukesh'],
};

const ERA_OF = new Map(ERAS.flatMap(era => ERA_MEMBERS[era].map(id => [id, era] as const)));
const ORDER = new Map(ERAS.flatMap(era => ERA_MEMBERS[era]).map((id, index) => [id, index]));

/** The figurine of a legend with one; undefined for a master downloaded by hand that has none. */
export const legendFigure = (id: string) => ERA_OF.has(id) ? `art/legends/${id}.webp` : undefined;

/** A legend's era; players outside the hall count as modern. */
export const legendEra = (id: string): Era => ERA_OF.get(id) ?? 'modern';

/** Oldest first, the order the hall walks through history. */
export const byHistory = (a: string, b: string) => (ORDER.get(a) ?? 999) - (ORDER.get(b) ?? 999);

export const eraArt = (era: Era) => `art/legends/era-${era}.webp`;
export const hallArt = (name: 'pedestal' | 'plaque' | 'rope' | 'banner' | 'wreath' | 'swords' | 'cloud') =>
  `art/legends/hall-${name}.webp`;

const video = (name: string) => `art/video/${name}.webp`;

/** Where a legend made history, a diorama shown behind their figurine (art/source/video, see torre-sh-video). */
const LEGEND_VENUES: Record<string, string> = {
  Anderssen: 'venue-london-1851', Morphy: 'venue-paris-opera-1858', Botvinnik: 'venue-moscow-match',
  Smyslov: 'venue-moscow-match', Tal: 'venue-riga', Spassky: 'venue-reykjavik-1972', Fischer: 'venue-reykjavik-1972',
  Karpov: 'venue-moscow-1985', Kasparov: 'venue-moscow-1985',
};
export const legendVenue = (id: string) => (LEGEND_VENUES[id] ? video(LEGEND_VENUES[id]) : undefined);

/** A legend's figure after a match: celebrating a win, or taking a loss in their own way. */
const LEGEND_POSES: Record<string, { won?: string; lost?: string }> = {
  Anderssen: { won: 'figure-anderssen-evergreen' }, Morphy: { won: 'figure-morphy-opera' },
  Tal: { won: 'figure-tal-champion', lost: 'figure-tal-thinking' }, Smyslov: { lost: 'figure-smyslov-shocked' },
  Botvinnik: { lost: 'figure-botvinnik-worried' }, Spassky: { won: 'figure-spassky-calm', lost: 'figure-spassky-applauds' },
  Fischer: { won: 'figure-fischer-champion', lost: 'figure-fischer-alone' }, Larsen: { won: 'figure-larsen-bold' },
  Najdorf: { lost: 'figure-najdorf-resigns' }, Kasparov: { won: 'figure-kasparov-champion', lost: 'figure-kasparov-fierce' },
  Karpov: { won: 'figure-karpov-rival' }, Capablanca: { won: 'figure-capablanca-qgd' }, Alekhine: { won: 'figure-alekhine-attack' },
};
export const legendPose = (id: string, outcome: 'won' | 'lost') => {
  const name = LEGEND_POSES[id]?.[outcome];
  return name ? video(name) : undefined;
};
