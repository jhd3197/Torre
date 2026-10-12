import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChessBoard } from '../../components/ChessBoard';
import type { MascotPose } from '../../components/Reward';
import { usePosition } from '../../hooks/useChess';
import { usePlanning } from '../../hooks/usePlanning';
import { useVerdictSound } from '../../hooks/useSounds';
import type { ChooseStep, Move } from '../../types';
import { useAutoplayStart, useSpeakThenContinue } from './cinema';
import { StepLayout, type ScoredProps, type StepBar } from './StepLayout';

const NO_MOVES: Move[] = [];

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

  function check() {
    if (selected === null || committed) return;
    const tries = attempts + 1;
    setAttempts(tries);
    setCommitted(true);
    // Solved: post the step's result (wrong checks alone never post; once solved, the step is over).
    if (step.options[selected].correct) report({ firstTry: tries === 1, hintsUsed: 0, revealsUsed: 0, attempts: tries });
  }

  function retry() { setCommitted(false); setSelected(null); }

  const bar: StepBar = solved
    ? { verdict: 'correct', title: t('step.nicelyDone'), explanation: option?.why ?? undefined,
        primary: { label: last ? t('step.finish') : t('step.continue'), onClick: onContinue } }
    : committed
      ? { verdict: 'wrong', title: t('step.tryAgain'), explanation: option?.why ?? t('choose.tryAnother'),
          primary: { label: t('step.retry'), onClick: retry } }
      : { primary: { label: selected === null ? t('choose.pick') : t('step.check'), onClick: check, disabled: selected === null } };

  return (
    <StepLayout step={step} cinema={cinema} bar={bar}
      teacher={{
        pose: committed ? (solved ? 'excited' : 'confused') : (step.pose as MascotPose | undefined) ?? 'thinking',
        line: step.narration ?? step.question,
        listen: () => cinema.speak({ narration: step.narration ?? step.question }),
      }}
      board={step.fen && <ChessBoard board={board} flipped={step.orientation === 'black'} planning={planning} movable={false} annotations={step.marks} />}>
      {step.narration && <p className="lesson-prompt">{step.question}</p>}
      <div className={`lesson-options${committed ? ' input-locked' : ''}`} role="group" aria-label={t('choose.answers')}>
        {step.options.map((o, i) => {
          const state = committed && i === selected ? (o.correct ? 'correct' : 'wrong') : !committed && i === selected ? 'picked' : '';
          return (
            <button key={i} type="button" className={`lesson-option${state ? ` ${state}` : ''}`} disabled={committed}
              aria-pressed={i === selected} onClick={e => { setSelected(i); e.currentTarget.blur(); }}>
              {o.text}
            </button>
          );
        })}
      </div>
    </StepLayout>
  );
}
