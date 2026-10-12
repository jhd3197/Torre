import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ChessBoard } from '../../components/ChessBoard';
import type { MascotPose } from '../../components/Reward';
import { judgeMove, playMove, usePosition, type MoveJudgement } from '../../hooks/useChess';
import { usePlanning } from '../../hooks/usePlanning';
import { useSounds, useVerdictSound } from '../../hooks/useSounds';
import { useToast } from '../../state/AppData';
import type { Move, PlayLine, PlayStep } from '../../types';
import { DEMO_PLY_DELAY, REPLY_DELAY, useAutoplayStart, useSpeakThenContinue } from './cinema';
import { hintButton, useHintLadder, whyItFails } from './hints';
import { StepLayout, type ScoredProps, type StepBar } from './StepLayout';
import { moveLabel } from './text';

/** Wrong tries before the coach offers the first rung of the hint ladder by itself. */
const NUDGE_AFTER = 2;

type Line = PlayLine & { success: string | null };

const follows = (line: Line, played: Move[]) => line.moves.length > played.length && played.every((m, i) => line.moves[i].uci === m.uci);

/** Find the lesson's moves on the board; the other side's replies play themselves. Where the
 *  step's lines part at a reply, the opponent picks one, a line not seen yet first. */
export function PlayView({ step, onContinue, last, cinema, report }: ScoredProps<PlayStep>) {
  const { t } = useTranslation('lessons');
  const toast = useToast();
  const lines = useMemo<Line[]>(() => [
    { moves: step.moves, alternatives: step.alternatives, mate: step.mate, success: step.success }, ...(step.branches ?? [])], [step]);
  const [played, setPlayed] = useState<Move[]>([]);
  // The line the reader finished (its own success text), and every line finished so far.
  const [finished, setFinished] = useState<number | null>(null);
  const [seen, setSeen] = useState<number[]>([]);
  const [wrong, setWrong] = useState<string | null>(null);
  // A different move Stockfish rates as good as the lesson's: accepted when it ends the step,
  // otherwise a gentle "find the lesson's move". A worse one shows the line that answers it.
  const [other, setOther] = useState<{ san: string; lesson: string } | null>(null);
  const [alsoGood, setAlsoGood] = useState(false);
  const [judged, setJudged] = useState<MoveJudgement | null>(null);
  // "Show me": the answer to a wrong move played out on the board, a move at a time.
  const [preview, setPreview] = useState<{ moves: Move[]; at: number } | null>(null);
  const [misses, setMisses] = useState(0);
  const [busy, setBusy] = useState(false);
  const reportedRef = useRef(false);
  const ladder = useHintLadder(step.hint);
  const done = finished !== null;
  const shownMoves = preview ? [...played, ...preview.moves.slice(0, preview.at)] : played;
  const { board, current } = usePosition(step.fen, shownMoves);
  const planning = usePlanning(board);
  const sounds = useSounds('lesson');
  const side = step.fen.split(' ')[1] === 'b' ? 'black' : 'white';
  const live = lines.map((_, i) => i).filter(i => follows(lines[i], played));
  const expected = live.length ? lines[live[0]].moves[played.length] : undefined;
  const replyDue = !done && played.length % 2 === 1 && live.length > 0;

  // The verdict bar's chime or buzz, plus the coach's reaction pose.
  useVerdictSound(done ? 'correct' : wrong ? 'wrong' : 'neutral', 'lesson');

  // The reader's moves are the even ones; each correct one is answered after a short pause. Where
  // the lines part, a line not finished yet is preferred, so a replay shows the other defence.
  useEffect(() => {
    if (!replyDue) return;
    const fresh = live.filter(i => !seen.includes(i));
    const pool = fresh.length ? fresh : live;
    const line = lines[pool[Math.floor(Math.random() * pool.length)]];
    const reply = line.moves[played.length];
    const timer = setTimeout(() => { setPlayed(p => [...p, reply]); sounds.move(reply.san); }, REPLY_DELAY);
    return () => clearTimeout(timer);
    // `live` follows from `played`; picking again on every render would reroll the reply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyDue, played.length]);

  // "Show me" steps through the answer at reading pace.
  useEffect(() => {
    if (!preview || preview.at >= preview.moves.length) return;
    const timer = setTimeout(() => {
      setPreview(p => p && { ...p, at: p.at + 1 });
      sounds.move(preview.moves[preview.at].san);
    }, preview.at === 0 ? REPLY_DELAY : DEMO_PLY_DELAY);
    return () => clearTimeout(timer);
  }, [preview, sounds]);

  // Autoplay: the coach sets the task, then waits for the reader to solve it.
  useAutoplayStart(cinema.autoplay, () => cinema.speak({ narration: step.narration }));

  const success = finished !== null ? lines[finished].success ?? step.success : step.success;
  // Solved: the coach praises the move, and the lesson carries on once the praise has been heard.
  useSpeakThenContinue(done && cinema.autoplay, cinema.speak, success ?? t('play.wellDone'), onContinue);

  function accept(move: Move, line: number | null) {
    setPlayed(p => [...p, move]);
    setWrong(null);
    ladder.settle();
    sounds.move(move.san);
    if (line === null) return;
    setFinished(line);
    setSeen(s => s.includes(line) ? s : [...s, line]);
    // Solved: post the step's result once (wrong tries alone never post; a replay does not repost).
    if (reportedRef.current) return;
    reportedRef.current = true;
    report({ firstTry: misses === 0, hintsUsed: ladder.hintsUsed, revealsUsed: ladder.revealed ? 1 : 0, attempts: misses + 1 });
  }

  async function onMove(uci: string) {
    if (done || wrong || replyDue || !expected || preview) return;
    // The lines this move keeps going, and the first one it finishes (its last move, or a listed alternative).
    const matching = live.filter(i => {
      const line = lines[i], next = line.moves[played.length];
      return next.uci === uci || (played.length === line.moves.length - 1 && line.alternatives.some(m => m.uci === uci));
    });
    if (matching.length) {
      const ends = matching.find(i => played.length === lines[i].moves.length - 1);
      const line = lines[ends ?? matching[0]];
      const move = line.moves[played.length].uci === uci ? line.moves[played.length] : line.alternatives.find(m => m.uci === uci)!;
      return accept(move, ends ?? null);
    }
    const final = live.some(i => played.length === lines[i].moves.length - 1);
    setBusy(true);
    try {
      // Any checkmate solves the step, even one the lesson does not list.
      const result = await playMove(step.fen, played, uci);
      if (result.termination === 'checkmate') return accept({ uci, san: result.san }, live[0]);
      // Another move: Stockfish says whether it is just as good, or what answers it.
      const verdict = await judgeMove(step.fen, played, uci, expected.uci).catch(() => null);
      if (verdict?.verdict === 'good') {
        // As strong as the lesson's move. On the last move that solves the step; mid-line the
        // lesson's replies only follow its own line, so the reader is asked for that move instead.
        if (final) { setOther({ san: result.san, lesson: expected.san }); return accept({ uci, san: result.san }, live[0]); }
        setWrong(result.san);
        setAlsoGood(true);
        return;
      }
      setWrong(result.san);
      setJudged(verdict);
      setMisses(m => m + 1);
      // After a couple of misses the coach offers the first rung; never more without being asked.
      if (misses + 1 >= NUDGE_AFTER && ladder.shown.length === 0) ladder.climb();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setPlayed([]); setFinished(null); setWrong(null); setMisses(0); setOther(null); setPreview(null); ladder.reset(); retry();
  }
  function retry() { setWrong(null); setAlsoGood(false); setJudged(null); setPreview(null); }
  // Take back your last move and the reply to it, to try that moment again.
  function backOne() { setPlayed(p => p.slice(0, -2)); ladder.settle(); }
  function showMe() {
    if (!judged || !wrong) return;
    setPreview({ moves: judged.uci.map((uci, i) => ({ uci, san: judged.line[i] ?? uci })), at: 0 });
  }
  const opponent = t(side === 'white' ? 'side.black' : 'side.white');
  const refutation = judged?.line.slice(1) ?? null;
  const unseen = lines.some((_, i) => !seen.includes(i));

  const locked = done || wrong !== null || preview !== null;
  const promptLine = <><strong>{t(`toMove.${side}`)}</strong> {step.prompt}</>;
  const bar: StepBar = done
    ? { verdict: 'correct', title: other ? t('play.alsoStrong') : t('step.nicelyDone'),
        explanation: other
          ? <><Trans t={t} i18nKey="play.stockfishRates" values={{ san: other.san, lesson: other.lesson }} components={{ strong: <strong /> }} /> {success}</>
          : success ?? t('play.wellDone'),
        primary: { label: last ? t('step.finish') : t('step.continue'), onClick: onContinue },
        secondary: [{ label: unseen ? t('play.otherDefence') : t('play.playAgain'), onClick: restart }] }
    : preview
      ? { verdict: 'wrong', title: t('play.showingWhy', { san: wrong }),
          explanation: judged ? whyItFails(t, judged, opponent) : undefined,
          primary: { label: t('play.backToPosition'), onClick: retry, disabled: preview.at < preview.moves.length },
          secondary: preview.at >= preview.moves.length ? [{ label: t('play.watchAgain'), onClick: showMe }] : [] }
    : wrong && alsoGood
      ? { title: t('play.notThisIdea'),
          explanation: <Trans t={t} i18nKey="play.strongToo" values={{ san: wrong }} components={{ strong: <strong /> }} />,
          primary: { label: t('play.tryAgain'), onClick: retry } }
    : wrong
      ? { verdict: 'wrong', title: t('step.tryAgain'),
          explanation: <><Trans t={t} i18nKey="play.notTheMove" values={{ san: wrong }} components={{ strong: <strong /> }} />{refutation?.length
            ? <> <Trans t={t} i18nKey={refutation.length >= 3 ? 'play.answersLine' : 'play.answers'}
                values={{ opponent, reply: refutation[0], next: refutation[1], then: refutation[2] }} components={{ strong: <strong /> }} /></>
            : null}{judged && <> {whyItFails(t, judged, opponent)}</>}</>,
          primary: { label: t('step.retry'), onClick: retry },
          secondary: judged && judged.uci.length >= 2 ? [{ label: t('play.showMe'), onClick: showMe }] : [] }
      : { primary: { label: t('play.makeMove'), disabled: true },
          secondary: [
            ...(played.length >= 2 && !replyDue ? [{ label: t('play.backOne'), onClick: backOne }] : []),
            ...(played.length > 0 ? [{ label: t('play.startOver'), onClick: restart }] : []),
          ] };

  const pieceShown = ladder.shown.includes('piece') && expected && !done;
  const arrowShown = ladder.shown.includes('arrow') && expected && !done;
  return (
    <StepLayout step={step} cinema={cinema} bar={bar} hint={hintButton(t, ladder, !done && !wrong && !preview)}
      teacher={{
        pose: done ? 'excited' : wrong ? 'confused' : (step.pose as MascotPose | undefined) ?? 'playing',
        line: step.narration ?? promptLine,
        listen: () => cinema.speak({ narration: step.narration ?? step.prompt }),
      }}
      board={<div className={locked ? 'input-locked' : undefined}>
      <ChessBoard board={board} flipped={side === 'black'} planning={planning}
        movable={!locked && !replyDue && current ? 'turn' : false} onMove={onMove} busy={busy}
        annotations={played.length === 0 && !wrong ? step.marks : []} lastMove={shownMoves.at(-1)?.uci ?? null}
        highlight={pieceShown && !preview ? [expected.uci.slice(0, 2)] : []}
        bestMove={arrowShown && !preview ? expected.uci : null} />
    </div>}>
      {step.narration && <p className="lesson-prompt">{promptLine}</p>}
      {played.length > 0 && (
        <ol className="lesson-line" aria-label={t('step.movesSoFar')}>
          {played.map((m, i) => <li key={i} className={i % 2 ? 'reply' : ''}>{moveLabel(step.fen, i, m.san)}</li>)}
        </ol>
      )}
      {!done && <HintRungs shown={ladder.shown} nudge={step.nudge} hint={step.hint} san={expected?.san} />}
      {ladder.hard && !done && <p className="lesson-hint hard-mode">{t('hints.hardMode')}</p>}
    </StepLayout>
  );
}

/** The rungs climbed so far, as lines under the prompt. */
export function HintRungs({ shown, nudge, hint, san }: { shown: string[]; nudge?: string | null; hint?: string | null; san?: string }) {
  const { t } = useTranslation('lessons');
  const strong = { strong: <strong /> };
  return <>
    {shown.includes('nudge') && <p className="lesson-hint"><Trans t={t} i18nKey="step.hint" values={{ hint: nudge || t('hints.nudge') }} components={strong} /></p>}
    {shown.includes('hint') && hint && <p className="lesson-hint"><Trans t={t} i18nKey="step.hint" values={{ hint }} components={strong} /></p>}
    {shown.includes('piece') && <p className="lesson-hint">{t('hints.pieceCircled')}</p>}
    {shown.includes('arrow') && san && <p className="lesson-hint"><Trans t={t} i18nKey="play.arrow" values={{ san }} components={strong} /></p>}
  </>;
}
