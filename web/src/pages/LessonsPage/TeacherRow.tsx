import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Mascot, type MascotPose } from '../../components/Reward';

export type BubbleTone = 'neutral' | 'good' | 'bad' | 'hint';

/** The coach rook in its tile and its speech bubble. A verdict tints the bubble and heads it with a
 *  tag ("Nicely done!", "Try again."). */
export function TeacherRow({ pose, speaking, onListen, tone = 'neutral', tag, children }: {
  pose: MascotPose;
  speaking: boolean;
  onListen: () => void;
  tone?: BubbleTone;
  tag?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation('lessons');
  return (
    <div className="coach-row">
      <span className="coach-avatar"><Mascot pose={pose} size={72} /></span>
      <div className={`coach-bubble tone-${tone}`} role={tone === 'neutral' && !tag ? undefined : 'status'}>
        {tag && <strong className="bubble-tag">{tag}</strong>}
        <div className="bubble-text">{children}</div>
        <button type="button" className={`teacher-listen${speaking ? ' speaking' : ''}`} aria-label={t('teacher.listen')} title={t('teacher.listen')} onClick={onListen}>
          <img src="art/ui3d/sound.webp" alt="" width="16" height="16" />
        </button>
      </div>
    </div>
  );
}
