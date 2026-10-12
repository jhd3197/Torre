import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChessBoard } from '../../components/ChessBoard';
import { MiniBoard } from '../../components/MiniBoard';
import type { MascotPose } from '../../components/Reward';
import { usePosition } from '../../hooks/useChess';
import { usePlanning } from '../../hooks/usePlanning';
import { useVerdictSound } from '../../hooks/useSounds';
import type { ChooseStep, Move } from '../../types';
import { useAutoplayStart, useSpeakThenContinue } from './cinema';
import { StepLayout, type ScoredProps, type StepBar } from './StepLayout';

const NO_MOVES: Move[] = [];
/** Answers this short ("Yes", "No", "2") sit side by side as big buttons and answer on the tap. */
const SHORT = 6;

/** A multiple-choice question, optionally about a position on the board. */
export function ChooseView({ step, onContinue, last, cinema, report }: ScoredProps<ChooseStep>) {
  const { t } = useTranslation('lessons');
  const [selected, setSelected] = useState<number | null>(null);
  const [committed, setCommitted] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const { board } = usePosition(step.fen ?? '', NO_MOVES, !!step.fen);
  const planning = usePlanning(board);
  const option = selected !== null ? step.options[selected] : undefined;
  const solved = committed && !!option?.correct;
  useVerdictSound(solved ? 'correct' : committed ? 'wrong' : 'neutral', 'lesson');

  // Autoplay: the coach reads the question, then waits for the reader to answer.
  useAutoplayStart(cinema.autoplay, () => cinema.speak({ narration: step.narration }));

  // Solved: the coach explains the answer, the verdict shows, then the lesson carries on.
  useSpeakThenContinue(solved && cinema.autoplay, cinema.speak, option?.why ?? t('choose.right'), onContinue);

  // Pick the board (every option a position) and short answers commit on the tap; longer
  // answers are picked, then checked.
  const boards = step.options.every(o => o.fen);
  const short = !boards && step.options.every(o => o.text.length <= SHORT);
  const instant = boards || short;

  function check(pick = selected) {
    if (pick === null || committed) return;
    const tries = attempts + 1;
    setSelected(pick);
    setAttempts(tries);
    setCommitted(true);
    // Solved: post the step's result (wrong checks alone never post; once solved, the step is over).
    if (step.options[pick].correct) report({ firstTry: tries === 1, hintsUsed: 0, revealsUsed: 0, attempts: tries });
  }
  const choose = (i: number) => (instant ? check(i) : setSelected(i));

  function retry() { setCommitted(false); setSelected(null); }

  const bar: StepBar = solved
    ? { verdict: 'correct', title: t('step.nicelyDone'), explanation: option?.why ?? undefined,
        primary: { label: last ? t('step.finish') : t('step.continue'), onClick: onContinue } }
    : committed
      ? { verdict: 'wrong', title: t('step.tryAgain'), explanation: option?.why ?? t('choose.tryAnother'),
          primary: { label: t('step.retry'), onClick: retry } }
      : { primary: { label: selected === null || instant ? t('choose.pick') : t('step.check'), onClick: () => check(), disabled: selected === null || instant } };
  const optionState = (o: ChooseStep['options'][number], i: number) =>
    committed && i === selected ? (o.correct ? 'correct' : 'wrong') : !committed && i === selected ? 'picked' : '';
  // Once answered, the board shows why: the reveal marks join the step's own.
  const annotations = committed && step.reveal?.length ? [...step.marks, ...step.reveal] : step.marks;

  return (
    <StepLayout step={step} cinema={cinema} bar={bar}
      teacher={{
        pose: committed ? (solved ? 'excited' : 'confused') : (step.pose as MascotPose | undefined) ?? 'thinking',
        line: step.narration ?? step.question,
        listen: () => cinema.speak({ narration: step.narration ?? step.question }),
      }}
      board={boards
        ? <div className={`choose-boards${committed ? ' input-locked' : ''}`} role="group" aria-label={t('choose.answers')}>
            {step.options.map((o, i) => {
              const state = optionState(o, i);
              return (
                <button key={i} type="button" className={`choose-board${state ? ` ${state}` : ''}`} disabled={committed}
                  aria-label={o.text} onClick={() => choose(i)}>
                  <MiniBoard fen={o.fen} />
                  <span className="choose-board-label">{o.text}</span>
                </button>
              );
            })}
          </div>
        : step.fen && <ChessBoard board={board} flipped={step.orientation === 'black'} planning={planning} movable={false} annotations={annotations} />}>
      {step.narration && <p className="lesson-prompt">{step.question}</p>}
      {!boards && (
        <div className={`lesson-options${short ? ' short' : ''}${committed ? ' input-locked' : ''}`} role="group" aria-label={t('choose.answers')}>
          {step.options.map((o, i) => {
            const state = optionState(o, i);
            return (
              <button key={i} type="button" className={`lesson-option${state ? ` ${state}` : ''}`} disabled={committed}
                aria-pressed={i === selected} onClick={e => { choose(i); e.currentTarget.blur(); }}>
                {o.text}
              </button>
            );
          })}
        </div>
      )}
    </StepLayout>
  );
}
