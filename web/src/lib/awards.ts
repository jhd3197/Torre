// Awards (achievements.py): counts with four thresholds, shown as tiered badges.
import i18n from '../i18n';

export type AwardTier = 'locked' | 'unlocked' | 'bronze' | 'silver' | 'gold';
export type AwardFamily = 'milestones' | 'tactics' | 'strategy';

export interface Award {
  id: string;
  family: AwardFamily;
  title: string;
  description: string;
  unit: string;
  thresholds: number[];
  count: number;
  /** 0 locked, 1 unlocked, 2 bronze, 3 silver, 4 gold. */
  level: number;
  tier: AwardTier;
  next: number | null;
}

export interface AwardGain { id: string; title: string; tier: Exclude<AwardTier, 'locked'> }

// Names are read from the translation files on every access, so they follow the chosen language.
const translated = <K extends string>(keys: readonly K[], prefix: string) => Object.defineProperties({} as Record<K, string>,
  Object.fromEntries(keys.map(key => [key, { enumerable: true, get: () => i18n.t(`${prefix}.${key}`) }])));

export const FAMILY_TITLES = translated<AwardFamily>(['milestones', 'tactics', 'strategy'], 'awards:families');
export const TIER_NAMES = translated<AwardTier>(['locked', 'unlocked', 'bronze', 'silver', 'gold'], 'awards:tiers');

/** The badge art: full colour once unlocked, then the metal of the tier; locked badges reuse the colour art, greyed in CSS. */
export const badgeImage = (id: string, tier: AwardTier) =>
  `art/badges/${id}-${tier === 'locked' || tier === 'unlocked' ? 'color' : tier}.webp`;

/** Progress toward the next threshold, 0 to 1 (1 at gold). */
export function progress(award: Pick<Award, 'count' | 'level' | 'thresholds'>): number {
  if (award.level >= award.thresholds.length) return 1;
  const floor = award.level ? award.thresholds[award.level - 1] : 0;
  const goal = award.thresholds[award.level];
  return Math.max(0, Math.min(1, (award.count - floor) / (goal - floor)));
}
