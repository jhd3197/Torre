// Brand art: the rook mascot and the star rating.
import { useTranslation } from 'react-i18next';
export type MascotPose =
  | 'thumbs-up' | 'sleepy' | 'trophy' | 'detective' | 'puzzle' | 'check' | 'star' | 'happy' | 'wink' | 'thinking' | 'playing'
  | 'idea' | 'excited' | 'confused' | 'shocked' | 'content' | 'determined' | 'yawn' | 'starry' | 'shrug' | 'shield'
  | 'confetti' | 'alarm' | 'salute' | 'dizzy' | 'clap'
  // Feelings beyond happy: losses, blunders and relief.
  | 'sad' | 'teary' | 'facepalm' | 'nervous' | 'panic' | 'relieved' | 'proud' | 'sheepish' | 'bored'
  // The coach at work: greeting, explaining, pointing at the board.
  | 'neutral' | 'wave' | 'point' | 'present' | 'pointer' | 'nod' | 'no' | 'ready' | 'move-piece' | 'calculating' | 'notes'
  | 'magnify' | 'dancing' | 'hug'
  // Teaching an opening: hosting, offering a gift, pointing at the board, warning, studying, cheering.
  | 'host' | 'gift' | 'point-board' | 'warn' | 'study' | 'cheer'
  // The black rival rook, for opponents.
  | 'rival';

export function Mascot({ pose, size = 120, className = '' }: { pose: MascotPose; size?: number; className?: string }) {
  return <img className={`mascot ${className}`.trim()} src={`art/mascot/${pose}.webp`} alt="" width={size} height={size} />;
}

/** Three stars, the first `count` gold. `animate` pops them in one after another. */
export function Stars({ count, size = 20, animate = false, label }: { count: number; size?: number; animate?: boolean; label?: string }) {
  const { t } = useTranslation('board');
  return (
    <span className={`stars${animate ? ' stars-animate' : ''}`} role="img" aria-label={label ?? t('stars', { count })}>
      {[0, 1, 2].map(i => (
        <img key={i} className={i < count ? 'star-gold' : 'star-empty'} src={`art/stars/star-${i < count ? 'gold' : 'empty'}.png`}
          alt="" width={size} height={size} style={animate ? { animationDelay: `${250 + i * 320}ms` } : undefined} />
      ))}
    </span>
  );
}

export const brandIcon = (name: 'hint' | 'resign') => `art/icons/${name}.png`;
