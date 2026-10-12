import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChessBoard } from '../../components/ChessBoard';
import { NavIcon } from '../../components/NavIcon';
import type { MascotPose } from '../../components/Reward';
import { usePosition } from '../../hooks/useChess';
import { usePlanning } from '../../hooks/usePlanning';
import type { ExplainStep } from '../../types';
import { AUTO_ADVANCE_DELAY, DEMO_PLY_DELAY, useAutoplayStart, useContinueAfter } from './cinema';
import { StepLayout, type StepProps } from './StepLayout';
import { listenText, moveLabel, narrationBeats, spokenText } from './text';

// Autoplay pacing for explain steps: how long a cued move stays before the coach goes on
// (longer for a capture), and how long the final position holds before the next step.
const CUE_HOLD = 1300;
const CAPTURE_HOLD = 1900;
const FINAL_HOLD = 2600;

/** The coach explains an idea, with an optional demo line played on the board. */
export function ExplainView({ step, onContinue, last, cinema }: StepProps<ExplainStep>) {
  const { t } = useTranslation('lessons');
  const [ply, setPly] = useState(0);
  const [auto, setAuto] = useState(false);
  // Autoplay has said every piece and played every move: what is left is the final hold.
  const [scriptDone, setScriptDone] = useState(false);
  const { board } = usePosition(step.fen, step.demo.slice(0, ply));
  const planning = usePlanning(board);
  const shown = ply ? step.demo[ply - 1] : null;
  const captured = shown && shown.san.includes('x') ? shown.uci.slice(2, 4) : null;

  // Autoplay: the coach and the board take turns. Each spoken piece is heard to its end, then the
  // move it set up plays and stays a moment (a capture a little longer), and the coach carries on.
  // Moves the script does not cue play after the last piece; the final position holds before the
  // next step. Without cues, that is: the whole line said first, then the demo.
  useAutoplayStart(cinema.autoplay, () => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => { timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms)); };
    const beats = narrationBeats(step.narration);
    const cues = Math.min(beats.length - 1, step.demo.length);
    const isCapture = (n: number) => step.demo[n].san.includes('x');

    const finish = (n: number) => {
      if (n < step.demo.length) {
        later(() => { setPly(n + 1); finish(n + 1); }, n === cues ? CUE_HOLD : DEMO_PLY_DELAY);
        return;
      }
      setScriptDone(true);
    };
    const say = (k: number) => {
      const next = () => {
        if (cancelled) return;
        if (k >= cues) { finish(cues); return; }
        setPly(k + 1);
        later(() => say(k + 1), isCapture(k) ? CAPTURE_HOLD : CUE_HOLD);
      };
      if (!beats[k]) { next(); return; }
      cinema.speak({ narration: beats[k] }, next);
    };
    setAuto(false);
    setPly(0);
    say(0);
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, () => setScriptDone(false));
  useContinueAfter(cinema.autoplay && scriptDone, onContinue, step.demo.length ? FINAL_HOLD : AUTO_ADVANCE_DELAY);

  // A manual replay: one pass through the demo line.
  useEffect(() => {
    if (!auto) return;
    if (ply >= step.demo.length) { setAuto(false); return; }
    const timer = setTimeout(() => setPly(p => p + 1), DEMO_PLY_DELAY);
    return () => clearTimeout(timer);
  }, [auto, ply, step.demo.length]);

  const stepTo = (n: number) => { setAuto(false); setPly(n); };
  const replay = () => { setPly(0); setAuto(true); };

  return (
    <StepLayout step={step} cinema={cinema} bar={{ primary: { label: last ? t('step.finish') : t('step.continue'), onClick: onContinue } }}
      teacher={{
        pose: (step.pose as MascotPose | undefined) ?? 'happy',
        line: step.narration ? spokenText(step.narration) : step.text,
        listen: () => cinema.speak({ narration: step.narration ? listenText(step.narration) : step.text }),
      }}
      board={<ChessBoard board={board} flipped={step.orientation === 'black'} planning={planning} movable={false}
        annotations={ply === 0 ? step.marks : []} lastMove={shown?.uci ?? null} flash={captured} />}>
      {step.narration && step.text !== spokenText(step.narration) && <p className="lesson-text">{step.text}</p>}
      {step.demo.length > 0 && (
        <div className="lesson-demo">
          <button type="button" className="icon-button" aria-label={t('step.previousMove')} disabled={ply === 0} onClick={() => stepTo(ply - 1)}><NavIcon to="previous" /></button>
          <ol>
            {step.demo.map((m, i) => (
              <li key={i}><button type="button" className={i < ply ? 'played' : ''} aria-current={i === ply - 1 ? 'step' : undefined}
                onClick={() => stepTo(i + 1)}>{moveLabel(step.fen, i, m.san)}</button></li>
            ))}
          </ol>
          <button type="button" className="icon-button" aria-label={t('step.nextMove')} disabled={ply === step.demo.length} onClick={() => stepTo(ply + 1)}><NavIcon to="next" /></button>
          <button type="button" className="icon-button lesson-replay" aria-label={t('step.replay')} title={t('step.replayTitle')} onClick={replay}>
            <img src="art/ui3d/play.webp" alt="" width="15" height="15" />
          </button>
        </div>
      )}
    </StepLayout>
  );
}
