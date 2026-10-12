// A drill step (stars, reach, capture, count): a little game for one piece, on a layout made fresh
// from the step's recipe each time it opens. Hints climb three rungs like the design: a nudge in
// words, then the line to follow glows, then an arrow shows the move.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MascotPose } from '../../components/Reward';
import { useSounds, useVerdictSound } from '../../hooks/useSounds';
import { between, lines, makeDrill, nextMove, reach, squareName, whyNot, type DrillLayout, type Occupants } from '../../lib/drills';
import { hardMode } from '../../lib/settings';
import type { DrillStep } from '../../types';
import { useAutoplayStart, useContinueAfter, useSpeakThenContinue } from './cinema';
import { DrillBoard, DrillStar, type DrillMarks } from './DrillBoard';
import { StepLayout, type ScoredProps, type StepBar } from './StepLayout';

/** How long each move of a watched drill takes. */
const WATCH_BEAT = 1300;
const HINT_RUNGS = 3;

type Feedback = { text: string; tag?: string; tone: 'neutral' | 'good' | 'bad' | 'hint' };

interface Run {
  layout: DrillLayout;
  at: number;
  stars: number[];
  enemies: Record<number, string>;
  moves: number;
  solved: boolean;
  /** Hint rung showing for the current position (0 to 3); a move starts it over. */
  hint: number;
  last: { from: number; to: number } | null;
  pick: number | null;
}

const fresh = (step: DrillStep): Run => {
  const layout = makeDrill(step);
  return { layout, at: layout.from, stars: [...layout.stars], enemies: { ...layout.enemies }, moves: 0, solved: false, hint: 0, last: null, pick: null };
};

export function DrillView({ step, onContinue, last, cinema, report }: ScoredProps<DrillStep>) {
  const { t } = useTranslation('lessons');
  const sounds = useSounds('lesson');
  const hard = hardMode.use();
  const [run, setRun] = useState(() => fresh(step));
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [wrong, setWrong] = useState<number | null>(null);
  const [burst, setBurst] = useState<number | null>(null);
  // Tallies for the score, across new boards: the step reports once, on its first solve.
  const tally = useRef({ mistakes: 0, hints: 0, reveals: 0, reported: false });
  const watching = step.kind === 'stars' && !!step.watch;
  const { layout } = run;
  const piece = t(`drill.piece.${step.piece}`);
  const board: Occupants = { own: new Set(layout.own), enemies: run.enemies };
  const targets = step.kind === 'stars' ? run.stars : layout.goal !== null ? [layout.goal] : [];

  useVerdictSound(run.solved && !watching ? 'correct' : 'neutral', 'lesson');

  // Flashes clear themselves.
  useEffect(() => {
    if (wrong === null) return;
    const timer = setTimeout(() => setWrong(null), 700);
    return () => clearTimeout(timer);
  }, [wrong]);
  useEffect(() => {
    if (burst === null) return;
    const timer = setTimeout(() => setBurst(null), 600);
    return () => clearTimeout(timer);
  }, [burst]);

  // Watching: the coach plays the shortest route, one move per beat.
  useEffect(() => {
    if (!watching || run.solved) return;
    const timer = setTimeout(() => {
      const move = run.layout.route[run.moves];
      if (!move) { setRun(r => ({ ...r, solved: true })); return; }
      land(move[1], move[0]);
    }, run.moves === 0 ? WATCH_BEAT * 0.8 : WATCH_BEAT);
    return () => clearTimeout(timer);
    // `land` reads the run it is given; the beat follows the move count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, run.solved, run.moves, run.layout]);

  useAutoplayStart(cinema.autoplay, () => { if (step.narration) cinema.speak({ narration: step.narration }); });
  const praise = step.success ?? null;
  useSpeakThenContinue(run.solved && cinema.autoplay && !watching && !!praise, cinema.speak, praise ?? '', onContinue);
  useContinueAfter(run.solved && cinema.autoplay && (watching || !praise), onContinue);

  function solve(extra: Partial<Run>, text: string) {
    setRun(r => ({ ...r, ...extra, solved: true }));
    setFeedback({ text: step.success ?? text, tag: t('drill.greatJob'), tone: 'good' });
    if (watching || tally.current.reported) return;
    tally.current.reported = true;
    const { mistakes, hints, reveals } = tally.current;
    const overPar = step.kind === 'stars' && (extra.moves ?? 0) > layout.par;
    report({ firstTry: mistakes === 0 && hints === 0 && reveals === 0 && !overPar, hintsUsed: hints, revealsUsed: reveals, attempts: mistakes + 1 });
  }

  /** Move the piece to `to` (already checked legal) and judge it. */
  function land(to: number, from = run.at) {
    const capture = !!run.enemies[to];
    sounds.move(capture ? `${step.piece}x` : step.piece);
    const enemies = { ...run.enemies };
    delete enemies[to];
    const moved: Partial<Run> = { at: to, enemies, moves: run.moves + 1, last: { from, to }, hint: 0 };
    if (step.kind === 'stars') {
      const stars = run.stars.filter(s => s !== to);
      const got = stars.length < run.stars.length;
      if (got) setBurst(to);
      if (!stars.length) {
        if (watching) { setRun(r => ({ ...r, ...moved, stars })); setFeedback({ text: t('drill.watchDone', { count: layout.stars.length, moves: run.moves + 1 }), tone: 'neutral' }); return; }
        const moves = run.moves + 1;
        return solve({ ...moved, stars }, moves <= layout.par
          ? t('drill.starsDone', { count: layout.stars.length, moves })
          : t('drill.starsOverPar', { moves, par: layout.par }));
      }
      setRun(r => ({ ...r, ...moved, stars }));
      setFeedback({ text: watching ? t('drill.watchMove', { piece, square: squareName(to) })
        : got ? t('drill.gotStar', { count: stars.length }) : t('drill.lineUp'), tone: 'neutral' });
      return;
    }
    if (to === layout.goal) {
      return solve(moved, step.kind === 'capture'
        ? t('drill.captureDone', { target: t(`drill.piece.${layout.enemies[to].toUpperCase()}`) })
        : t('drill.reachDone', { moves: run.moves + 1 }));
    }
    setRun(r => ({ ...r, ...moved }));
    setFeedback({ text: t('drill.keepGoing'), tone: 'neutral' });
  }

  function miss(square: number, text: string) {
    tally.current.mistakes += 1;
    setWrong(square);
    sounds.wrong();
    setFeedback({ text, tag: t('drill.notQuite'), tone: 'bad' });
  }

  function tap(square: number) {
    if (run.solved || watching || step.kind === 'count' || square === run.at) return;
    const legal = reach(step.piece, run.at, board);
    if (!legal.includes(square)) {
      const why = whyNot(step.piece, run.at, square, board);
      return miss(square, why === 'own' ? t('drill.own') : why === 'blocked' ? t('drill.blocked') : t(`drill.rule.${step.piece}`));
    }
    // Capture is one move: the move that takes nothing is the near miss to point out.
    if (step.kind === 'capture' && square !== layout.goal) {
      return miss(square, run.enemies[square] ? t('drill.blocked') : t('drill.noCapture'));
    }
    land(square);
  }

  function pick(value: number) {
    if (run.solved) return;
    if (value === layout.answer) {
      setRun(r => ({ ...r, pick: value }));
      return solve({ pick: value }, t('drill.countRight', { count: value }));
    }
    setRun(r => ({ ...r, pick: value }));
    miss(-1, value > layout.answer! ? t('drill.countHigh') : t('drill.countLow'));
  }

  function climb() {
    if (run.solved || run.hint >= HINT_RUNGS || hard) return;
    const rung = run.hint + 1;
    if (rung === HINT_RUNGS) tally.current.reveals += 1;
    else tally.current.hints += 1;
    setRun(r => ({ ...r, hint: rung }));
    const words = step.kind === 'count'
      ? t(`drill.countHint${rung}`)
      : rung === 1 ? step.nudge ?? t(`drill.nudge.${step.kind}`) : rung === 2 ? t('drill.hintLine') : t('drill.hintArrow');
    setFeedback({ text: words, tag: t('drill.hintTag', { rung, total: HINT_RUNGS }), tone: 'hint' });
  }

  function newBoard() {
    setRun(fresh(step));
    setFeedback(null);
  }

  // What the board shows: dots for the moves (not in capture, where finding them is the drill),
  // the hint glow and arrow, and the count drill's dots as its hints uncover them.
  const marks: DrillMarks = { dots: [], rings: [], glow: [], arrow: null, wrong, last: run.last, burst,
    solved: run.solved && !watching && step.kind !== 'count' ? run.at : null,
    active: !run.solved && !watching && step.kind !== 'count' ? run.at : null };
  if (!run.solved && !watching && (step.kind === 'stars' || step.kind === 'reach')) marks.dots = reach(step.piece, run.at, board);
  if (step.kind === 'count') {
    const all = reach(step.piece, run.at, board);
    const dirs = lines(step.piece);
    marks.dots = run.solved || run.hint >= 3 ? all : run.hint === 2 ? reach(step.piece, run.at, board, false, dirs.slice(0, Math.ceil(dirs.length / 2))) : [];
  } else if (!run.solved && !watching && run.hint >= 2) {
    const next = nextMove(step.piece, run.at, targets, board);
    if (next) {
      if (run.hint === 2) marks.glow = between(step.piece, next[0], next[1]);
      else { marks.glow = [next[1]]; marks.arrow = { from: next[0], to: next[1], tone: 'hint' }; }
    }
  }
  if (watching && run.last) marks.arrow = { ...run.last, tone: 'watch' };

  const prompt = step.prompt ?? step.narration ?? t(`drill.prompt.${watching ? 'watch' : step.kind}`, { count: layout.stars.length, piece });
  const pose: MascotPose = run.solved ? 'excited' : feedback?.tone === 'bad' ? 'confused' : feedback?.tone === 'hint' ? 'thinking'
    : (step.pose as MascotPose | undefined) ?? (watching ? 'point' : 'detective');
  const showing = feedback ?? { text: prompt, tone: 'neutral' as const };
  const ready = run.solved;
  const bar: StepBar = {
    verdict: ready && !watching ? 'correct' : 'neutral',
    title: showing.tag,
    explanation: showing.text,
    tone: showing.tone,
    primary: ready ? { label: last ? t('step.finish') : t('step.continue'), onClick: onContinue }
      : { label: watching ? t('guess.watching') : step.kind === 'count' ? t('choose.pick') : t('drill.completeTask'), disabled: true },
    secondary: ready ? [{ label: watching ? t('drill.watchAgain') : t('drill.newBoard'), onClick: newBoard }] : [],
  };
  const hint = watching || hard || run.solved ? undefined : {
    label: t('step.showHint'), used: run.hint, total: HINT_RUNGS, onClick: climb, disabled: run.hint >= HINT_RUNGS,
  };
  const collected = layout.stars.length - run.stars.length;

  return (
    <StepLayout step={step} cinema={cinema} bar={bar} hint={hint}
      teacher={{ pose, line: showing.text, listen: () => cinema.speak({ narration: step.narration ?? showing.text }) }}
      board={<DrillBoard piece={step.piece} at={run.at} own={layout.own} enemies={run.enemies} stars={run.stars}
        flag={step.kind === 'reach' ? layout.goal : null} marks={marks} onTap={tap}
        interactive={!run.solved && !watching && step.kind !== 'count'} />}>
      {step.kind === 'stars' && (
        <div className="drill-tray" aria-label={t('drill.collected', { count: collected, total: layout.stars.length })}>
          <span className="drill-tray-stars">
            {layout.stars.map((s, i) => <span key={s} className={i < collected ? 'got' : ''}><DrillStar /></span>)}
          </span>
          {!watching && <span className="drill-moves">{t('drill.moves', { count: run.moves, par: layout.par })}</span>}
        </div>
      )}
      {step.kind === 'count' && layout.options && (
        <div className="drill-options" role="group" aria-label={t('choose.answers')}>
          {layout.options.map(value => {
            const state = run.pick === value ? (value === layout.answer ? 'correct' : 'wrong') : '';
            return <button key={value} type="button" className={`drill-option${state ? ` ${state}` : ''}`} disabled={run.solved}
              onClick={() => pick(value)}>{value}</button>;
          })}
        </div>
      )}
    </StepLayout>
  );
}
