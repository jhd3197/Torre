// Rooky's recap of a reviewed game, said on its own the first time the review is ready: the result,
// the story of the evaluation and the slips (lib/commentary.ts recapLines), then what the coach
// makes of it (/api/games/<id>/coach): the focus skill this game touched and the lesson built from
// it, which the buttons open.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Mascot, type MascotPose } from './Reward';
import { RookSpeaker, hasHeard, rookyAutoplay } from './RookSpeaker';
import { REVIEW_RATE } from '../hooks/useReviewVoice';
import { api } from '../lib/api';
import { lessonPath } from '../lib/routes';

interface GameCoach { lesson: string | null; focusSkill: string | null; lines: string[]; completed: string | null }

/** The key a game's recap is remembered under once said (RookSpeaker autoKey). */
export const recapKey = (id: string | number) => `recap:${id}`;
/** Whether opening this game will play its recap on its own (so the page can show it). */
export const recapWillPlay = (id: string | number) => rookyAutoplay.get() === 'on' && !hasHeard(recapKey(id));

export function GameRecap({ gameId, recap, analyzed, pose, autoplay = true }: {
  gameId: string | number | null;
  /** Say it on its own the first time (a game opened as a whole); otherwise only on request. */
  autoplay?: boolean;
  /** The recap lines, empty while the review is still running. */
  recap: string[];
  analyzed: boolean;
  pose: MascotPose;
}) {
  const { t } = useTranslation('rooky');
  const [coach, setCoach] = useState<GameCoach | null>(null);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    if (gameId == null || !analyzed) { setAsked(true); return; }
    let live = true;
    setAsked(false);
    api<GameCoach>(`api/games/${encodeURIComponent(String(gameId))}/coach`)
      .then(data => { if (live) setCoach(data); })
      .catch(() => { /* the recap still plays without the coach's part */ })
      .finally(() => { if (live) setAsked(true); });
    return () => { live = false; };
  }, [gameId, analyzed]);

  // The recap draws its words from varied pools on every render; what Rooky says is fixed the
  // first time it is ready, so the captions match the voice.
  const said = useRef<{ id: string | number | null; lines: string[] } | null>(null);
  if (recap.length > 0 && asked && said.current?.id !== gameId) said.current = { id: gameId, lines: [...recap, ...(coach?.lines ?? [])] };
  const lines = said.current?.id === gameId ? said.current.lines : [];
  if (!lines.length) {
    return <div className="panel-mascot" aria-hidden="true"><Mascot pose={pose} size={150} /></div>;
  }
  return (
    <RookSpeaker className="game-recap-rooky" lines={lines} pose={pose} rate={REVIEW_RATE} size={110}
      autoKey={autoplay && gameId != null ? recapKey(gameId) : null}>
      {coach?.lesson && <Link className="button primary" to={lessonPath(coach.lesson)}>
        {coach.completed ? t('recap.lessonDone') : t('recap.lesson')}
      </Link>}
      <Link className="text-button" to="/coach">{t('recap.coach')}</Link>
    </RookSpeaker>
  );
}
