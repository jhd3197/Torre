import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChessBoard } from '../../components/ChessBoard';
import { NavIcon } from '../../components/NavIcon';
import type { MascotPose } from '../../components/Reward';
import { usePosition } from '../../hooks/useChess';
import { usePlanning } from '../../hooks/usePlanning';
import type { ReelStep } from '../../types';
import { DEMO_PLY_DELAY, useAutoplayStart, useContinueAfter } from './cinema';
import { StepLayout, type StepProps } from './StepLayout';
import { moveLabel } from './text';

const REEL_SPEEDS = [1, 2, 4];

/** A game played back like a video: transport bar, seek, speed, and the notes as subtitles. */
export function ReelView({ step, onContinue, last, cinema }: StepProps<ReelStep>) {
  const { t } = useTranslation('lessons');
  const [ply, setPly] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const { board } = usePosition(step.fen, step.moves.slice(0, ply));
  const planning = usePlanning(board);
  const atEnd = ply >= step.moves.length;

  // Autoplay: the coach sets the scene and the reel rolls; pausing the lesson pauses the reel.
  useAutoplayStart(cinema.autoplay, () => {
    cinema.speak({ narration: step.narration });
    setPly(0);
    setPlaying(true);
  }, () => setPlaying(false));

  // The playback loop: one ply per beat, faster at higher speeds.
  useEffect(() => {
    if (!playing) return;
    if (atEnd) { setPlaying(false); return; }
    const timer = setTimeout(() => setPly(p => p + 1), DEMO_PLY_DELAY / speed);
    return () => clearTimeout(timer);
  }, [playing, ply, atEnd, speed]);

  // The reel finished under autoplay: a beat, then the next step.
  useContinueAfter(cinema.autoplay && atEnd, onContinue);

  const seek = (n: number) => setPly(Math.max(0, Math.min(step.moves.length, n)));
  const caption = ply ? step.notes.filter(n => n.ply <= ply).at(-1) : undefined;

  return (
    <StepLayout step={step} cinema={cinema} bar={{ primary: { label: last ? t('step.finish') : t('step.continue'), onClick: onContinue } }}
      teacher={{
        pose: (step.pose as MascotPose | undefined) ?? 'playing',
        line: step.narration ?? step.text,
        listen: () => cinema.speak({ narration: step.narration ?? step.text }),
      }}
      board={<>
        <ChessBoard board={board} flipped={step.orientation === 'black'} planning={planning} movable={false}
          lastMove={ply ? step.moves[ply - 1].uci : null} />
        <p key={caption?.ply ?? 0} className={`reel-caption${caption ? '' : ' empty'}`} aria-live="polite">{caption?.text ?? ''}</p>
        <div className="reel-transport" role="group" aria-label={t('reel.playback')}>
          <button type="button" className="transport-button" aria-label={playing ? t('reel.pause') : t('reel.play')} title={playing ? t('reel.pause') : t('reel.play')}
            onClick={() => { if (!playing && atEnd) setPly(0); setPlaying(p => !p); }}>
            <img src={`art/ui3d/${playing ? 'pause' : 'play'}.webp`} alt="" width="18" height="18" />
          </button>
          <button type="button" className="icon-button" aria-label={t('step.previousMove')} disabled={ply === 0}
            onClick={() => { setPlaying(false); seek(ply - 1); }}><NavIcon to="previous" /></button>
          <input type="range" className="reel-scrub" min={0} max={step.moves.length} value={ply} aria-label={t('reel.seek')}
            onChange={e => { setPlaying(false); seek(Number(e.target.value)); }} />
          <button type="button" className="icon-button" aria-label={t('step.nextMove')} disabled={atEnd}
            onClick={() => { setPlaying(false); seek(ply + 1); }}><NavIcon to="next" /></button>
          <button type="button" className="reel-speed" aria-label={t('reel.speed', { speed })} title={t('reel.speedTitle')}
            onClick={() => setSpeed(REEL_SPEEDS[(REEL_SPEEDS.indexOf(speed) + 1) % REEL_SPEEDS.length])}>{speed}×</button>
          <span className="reel-ply">{ply} / {step.moves.length}</span>
        </div>
      </>}>
      {step.narration && <p className="lesson-text">{step.text}</p>}
      <ol className="lesson-demo reel-moves" aria-label={t('reel.moves')}>
        {step.moves.map((m, i) => (
          <li key={i}><button type="button" className={i < ply ? 'played' : ''} aria-current={i === ply - 1 ? 'step' : undefined}
            onClick={() => { setPlaying(false); seek(i + 1); }}>{moveLabel(step.fen, i, m.san)}</button></li>
        ))}
      </ol>
    </StepLayout>
  );
}
