import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Mascot, type MascotPose } from '../../components/Reward';

/** The coach rook and its speech bubble at the top of a step's panel. */
export function TeacherRow({ pose, speaking, onListen, children }: { pose: MascotPose; speaking: boolean; onListen: () => void; children: ReactNode }) {
  const { t } = useTranslation('lessons');
  return (
    <div className="lesson-teacher">
      <Mascot pose={pose} size={96} />
      <div className="teacher-bubble">
        {children}
        <button type="button" className={`teacher-listen${speaking ? ' speaking' : ''}`} aria-label={t('teacher.listen')} title={t('teacher.listen')} onClick={onListen}>
          <img src="art/ui3d/sound.webp" alt="" width="16" height="16" />
        </button>
      </div>
    </div>
  );
}
