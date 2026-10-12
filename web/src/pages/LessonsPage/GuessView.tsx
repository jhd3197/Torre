import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ChessBoard } from '../../components/ChessBoard';
import type { MascotPose } from '../../components/Reward';
import { playMove, usePosition } from '../../hooks/useChess';
import { usePlanning } from '../../hooks/usePlanning';
import { useSounds, useVerdictSound } from '../../hooks/useSounds';
import { useToast } from '../../state/AppData';
import type { GuessStep } from '../../types';
import { DEMO_PLY_DELAY, useAutoplayStart, useContinueAfter } from './cinema';
import { hintButton, useHintLadder } from './hints';
import { HintRungs } from './PlayView';
import { StepLayout, type ScoredProps, type StepBar } from './StepLayout';
import { moveLabel } from './text';

/** Wrong tries before the arrow shows the game move (never in hard mode). */
const GUESS_TRIES = 2;
/** Plies before a stop that play at reading pace; earlier ones go by quickly. */
const GUESS_LEAD_IN = 4;
const GUESS_FAST_DELAY = 350;
type GuessPhase = 'rolling' | 'asking' | 'answered' | 'done';

/**
 * Guess the move: the game plays itself and stops before each key move. The reader
 * finds it on the board; after two misses (or on request) the arrow shows what was played.
 */
export function GuessView({ step, onContinue, last, cinema, report }: ScoredProps<GuessStep>) {
  const { t } = useTranslation('lessons');
  const toast = useToast();
  const [ply, setPly] = useState(0);
  const [phase, setPhase] = useState<GuessPhase>('rolling');
  const [stop, setStop] = useState(0);
  const [tries, setTries] = useState<string[]>([]);
  const [found, setFound] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  const reportedRef = useRef(false);
  const statsRef = useRef({ wrong: 0, hints: 0, reveals: 0 });
  const played = step.moves.slice(0, ply);
  const { board, current } = usePosition(step.fen, played);
  const planning = usePlanning(board);
  const sounds = useSounds('lesson');
  const target: GuessStep['guesses'][number] | undefined = step.guesses[stop];
  const ladder = useHintLadder(target?.hint);
  const shown = ladder.shown.includes('arrow');
  const expected = step.moves[ply];
  const atEnd = ply >= step.moves.length;

  // Roll the game forward to the next stop (or the end), one ply per beat.
  useEffect(() => {
    if (phase !== 'rolling') return;
    if (target && ply >= target.ply - 1) { setPhase('asking'); return; }
    if (atEnd) { setPhase('done'); return; }
    // Far from the next stop the game hurries; the last few moves before it play at reading pace.
    const near = (target ? target.ply - 1 : step.moves.length) - ply <= GUESS_LEAD_IN;
    const timer = setTimeout(() => setPly(p => p + 1), near ? DEMO_PLY_DELAY : GUESS_FAST_DELAY);
    return () => clearTimeout(timer);
  }, [phase, ply, target, atEnd, step.moves.length]);

  // Autoplay: the coach sets the scene; the reader still answers every question.
  useAutoplayStart(cinema.autoplay, () => cinema.speak({ narration: step.narration }));

  // Every stop answered: carry on once the coach has finished explaining the last answer.
  useContinueAfter(phase === 'done' && cinema.autoplay && !cinema.speaking, onContinue);

  // Every stop answered: post the step's result once. The rolling loop above ends the step, so
  // this follows the phase rather than a click.
  const reportResult = useEffectEvent(() => {
    const stats = statsRef.current;
    report({
      firstTry: found.length === step.guesses.length && found.every(Boolean),
      hintsUsed: stats.hints + ladder.hintsUsed, revealsUsed: stats.reveals + (ladder.revealed ? 1 : 0), attempts: stats.wrong + step.guesses.length,
    });
  });
  useEffect(() => {
    if (phase !== 'done' || reportedRef.current) return;
    reportedRef.current = true;
    reportResult();
  }, [phase]);

  function answer() {
    setFound(f => [...f, tries.length === 0 && !shown]);
    setPly(p => p + 1);
    setPhase('answered');
    sounds.move(expected?.san);
    if (cinema.autoplay && target?.why) cinema.speak({ narration: target.why });
  }

  async function onMove(uci: string) {
    if (phase !== 'asking' || !expected || !target) return;
    if (uci === expected.uci || target.also.some(m => m.uci === uci)) return answer();
    setBusy(true);
    try {
      const result = await playMove(step.fen, played, uci);
      setTries(t => [...t, result.san]);
      sounds.wrong();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function keepWatching() {
    // Tally the stop just answered before moving on.
    if (target) {
      statsRef.current.wrong += tries.length;
      if (tries.length > 0 && target.hint && !ladder.shown.includes('hint')) statsRef.current.hints += 1;
      if (!shown && tries.length >= GUESS_TRIES && !ladder.hard) statsRef.current.reveals += 1;
    }
    setTries([]); ladder.reset(); setStop(s => s + 1); setPhase('rolling');
  }
  const skipAhead = () => setPly(Math.min(target ? target.ply - 1 : step.moves.length, step.moves.length));

  const caption = ply ? step.notes.filter(n => n.ply <= ply).at(-1) : undefined;
  const score = found.filter(Boolean).length;
  const revealed = phase === 'asking' && (shown || (!ladder.hard && tries.length >= GUESS_TRIES));
  const mover = board?.turn === 'black' ? 'black' : 'white';
  const lastFound = found.at(-1);
  useVerdictSound(phase === 'answered' ? (lastFound ? 'correct' : 'wrong') : 'neutral', 'lesson');
  const pose: MascotPose = phase === 'asking' ? (revealed ? 'no' : tries.length ? 'thinking' : 'detective')
    : phase === 'answered' ? (lastFound ? 'clap' : 'nod')
    : phase === 'done' ? (score === step.guesses.length ? 'starry' : 'thumbs-up')
    : (step.pose as MascotPose | undefined) ?? 'playing';
  const bubble = phase === 'asking' && target ? target.prompt
    : phase === 'answered' ? (target?.why ?? t('guess.thatWasTheMove'))
    : phase === 'done' ? t('guess.summary', { score, total: step.guesses.length })
    : step.narration ?? step.text;

  const bar: StepBar = phase === 'answered'
    ? { verdict: lastFound ? 'correct' : 'wrong', title: lastFound ? t('step.nicelyDone') : t('guess.itWas', { san: step.moves[ply - 1].san }),
        explanation: target?.why ?? undefined, primary: { label: t('guess.keepWatching'), onClick: keepWatching } }
    : phase === 'done'
      ? { primary: { label: last ? t('step.finish') : t('step.continue'), onClick: onContinue } }
      : phase === 'asking'
        ? { primary: { label: t('play.makeMove'), disabled: true } }
        : { primary: { label: t('guess.watching'), disabled: true },
            secondary: [{ label: target ? t('guess.skipToNext') : t('guess.skipToEnd'), onClick: skipAhead }] };

  return (
    <StepLayout step={step} cinema={cinema} bar={bar} hint={hintButton(t, ladder, phase === 'asking' && !revealed)}
      teacher={{ pose, line: bubble, listen: () => cinema.speak({ narration: bubble }) }}
      board={<>
      <div className={phase === 'answered' ? 'input-locked' : undefined}>
        <ChessBoard board={board} flipped={step.orientation === 'black'} planning={planning} busy={busy}
          movable={phase === 'asking' && current ? 'turn' : false} onMove={onMove}
          lastMove={ply ? step.moves[ply - 1].uci : null} bestMove={revealed && expected ? expected.uci : null}
          highlight={phase === 'asking' && ladder.shown.includes('piece') && expected ? [expected.uci.slice(0, 2)] : []} />
      </div>
      <p key={caption?.ply ?? 0} className={`reel-caption${caption ? '' : ' empty'}`} aria-live="polite">{caption?.text ?? ''}</p>
    </>}>
      {phase === 'rolling' && step.narration && <p className="lesson-text">{step.text}</p>}
      <p className="guess-score" aria-label={t('guess.score', { score, total: step.guesses.length })}>
        {step.guesses.map((g, i) => (
          <span key={g.ply} className={i < found.length ? (found[i] ? 'hit' : 'miss') : i === stop && phase === 'asking' ? 'now' : ''} />
        ))}
        <span className="guess-count">{score} / {step.guesses.length}</span>
      </p>
      {phase === 'asking' && <>
        <p className="lesson-prompt"><Trans t={t} i18nKey="guess.findPlayed" values={{ toMove: t(`toMove.${mover}`) }} components={{ strong: <strong /> }} /></p>
        {tries.length > 0 && (
          <p className="lesson-verdict missed"><Trans t={t} i18nKey={revealed ? 'guess.notGameMove' : 'guess.notGameMoveTryAgain'} values={{ san: tries.at(-1) }} components={{ strong: <strong /> }} /></p>
        )}
        <HintRungs shown={ladder.shown.filter(rung => rung !== 'arrow')} nudge={target?.nudge} hint={target?.hint} />
        {tries.length > 0 && target?.hint && !revealed && !ladder.shown.includes('hint') && !ladder.hard && <p className="lesson-hint"><Trans t={t} i18nKey="step.hint" values={{ hint: target.hint }} components={{ strong: <strong /> }} /></p>}
        {revealed && expected && <p className="lesson-hint"><Trans t={t} i18nKey="guess.arrow" values={{ san: expected.san }} components={{ strong: <strong /> }} /></p>}
      </>}
      {played.length > 0 && (
        <ol className="lesson-line" aria-label={t('step.movesSoFar')}>
          {played.map((m, i) => <li key={i}>{moveLabel(step.fen, i, m.san)}</li>)}
        </ol>
      )}
    </StepLayout>
  );
}
