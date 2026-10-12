// A brilliant or great move of yours in a review gets its moment: the grade pops, a chime plays and,
// for a brilliant one, paper falls. It happens once per move per visit (the page keeps `seen`), and it
// follows the app's motion and sound settings. Coming back to the move shows only the badge and the
// button that shares it.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Confetti } from '../Confetti';
import { ShareButton } from '../ShareButton';
import { useSounds } from '../../hooks/useSounds';
import { motionReduced } from '../../lib/settings';
import { gradeIcon } from '../../lib/grades';
import type { Sharer } from '../../hooks/useShare';
import type { ShareRequest } from '../../lib/share';

export type CelebratedGrade = 'brilliant' | 'great';

export const celebrated = (grade: string | null | undefined): grade is CelebratedGrade => grade === 'brilliant' || grade === 'great';

export function MoveCelebration({ moveKey, grade, seen, sharer, request }: {
  /** Names the move across the visit (game and ply), so it celebrates once. */
  moveKey: string;
  grade: CelebratedGrade;
  /** The moves already celebrated this visit; the celebration adds its own. */
  seen: Set<string>;
  /** Without one (a game the archive does not hold), there is nothing to share. */
  sharer?: Sharer;
  request?: () => ShareRequest;
}) {
  const { t } = useTranslation('common');
  const sounds = useSounds();
  const [fresh] = useState(() => !seen.has(moveKey));
  const [confetti] = useState(() => fresh && grade === 'brilliant' && !motionReduced());

  useEffect(() => {
    if (seen.has(moveKey)) return;
    seen.add(moveKey);
    if (grade === 'brilliant') sounds.complete();
    else sounds.correct();
  }, [moveKey, grade, seen, sounds]);

  return (
    <div className={`verdict-celebration grade-${grade}${fresh ? ' fresh' : ''}`} data-testid="move-celebration">
      {confetti && <Confetti />}
      <span className="celebration-badge">
        <img src={gradeIcon(grade)} alt="" width="20" height="20" />
        {t(`celebrate.${grade}`)}
      </span>
      {sharer && request && (
        <ShareButton sharer={sharer} request={request} className="text-button celebration-share" id="share-celebrated">
          {t(`share.${grade}`)}
        </ShareButton>
      )}
    </div>
  );
}
