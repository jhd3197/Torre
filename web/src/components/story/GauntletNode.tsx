// The puzzle gauntlet node: three puzzles cycled from the chapter's themes
// (real packs from puzzles/*.json via the same endpoints PuzzlesPage uses).
// Attempts report to the shared puzzle rating, like any solved puzzle.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { ChessBoard } from '../ChessBoard';
import { Mascot } from '../Reward';
import { VerdictBar } from '../VerdictBar';
import { usePuzzleSolver } from '../../hooks/usePuzzleSolver';
import { api } from '../../lib/api';
import { completeGauntlet } from '../../lib/story';
import { useToast } from '../../state/AppData';
import type { Puzzle, PuzzleAttempt } from '../../types';
import { moveLabel } from '../../pages/LessonsPage';
import type { StoryChapter } from '../../data/story';

export const GAUNTLET_SIZE = 3;
/** Error marker for "no fresh puzzle", translated when shown. */
const NO_FRESH = 'no-fresh';

export function GauntletNode({ chapter, onProgress }: { chapter: StoryChapter; onProgress?: (ratio: number) => void }) {
  const { t } = useTranslation('story');
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [solved, setSolved] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastByTheme = useRef<Record<string, string>>({});
  const seen = useRef(new Set<string>());
  const navigate = useNavigate();

  useEffect(() => { onProgress?.(done ? 1 : solved / GAUNTLET_SIZE); }, [solved, done, onProgress]);

  // The next puzzle: cycle the chapter's themes; `after` avoids repeats within a theme.
  const pick = useCallback(async (slot: number) => {
    setError(null);
    try {
      for (let skip = 0; skip < chapter.gauntletThemes.length; skip++) {
        const theme = chapter.gauntletThemes[(slot + skip) % chapter.gauntletThemes.length];
        const query = new URLSearchParams({ theme, ...(lastByTheme.current[theme] ? { after: lastByTheme.current[theme] } : {}) });
        const next = await api<{ id: string | null }>(`api/puzzles/next?${query}`);
        if (!next.id || seen.current.has(next.id)) continue;
        const picked = await api<Puzzle>(`api/puzzles/${encodeURIComponent(next.id)}`);
        lastByTheme.current[theme] = next.id;
        seen.current.add(next.id);
        setPuzzle(picked);
        return;
      }
      setError(NO_FRESH);
    } catch (e) { setError((e as Error).message); }
  }, [chapter]);

  useEffect(() => { void pick(0); }, [pick]);

  function advance() {
    const next = solved;
    if (next >= GAUNTLET_SIZE) {
      completeGauntlet(chapter.id);
      setDone(true);
      return;
    }
    setPuzzle(null);
    void pick(next);
  }

  if (done) {
    return (
      <div className="lesson-finished gauntlet-finished">
        <Mascot pose="starry" size={120} />
        <h3 className="icon-text"><img src="art/ui3d/level-complete.webp" alt="" width="30" height="30" />{t('gauntlet.cleared')}</h3>
        <p>{t('gauntlet.clearedBody', { chapter: chapter.title })}</p>
        <div className="lesson-actions">
          <button type="button" className="button primary squishy" onClick={() => navigate('/story')}>{t('gauntlet.continue')}</button>
        </div>
      </div>
    );
  }
  if (error) return <p className="lessons-empty" role="alert">{error === NO_FRESH ? t('gauntlet.noFresh') : error}</p>;
  if (!puzzle) return <p className="lessons-empty" role="status">{t('gauntlet.loading', { number: solved + 1, total: GAUNTLET_SIZE })}</p>;
  return (
    <div className="gauntlet">
      <p className="guess-score gauntlet-progress" aria-label={t('gauntlet.progress', { number: solved + 1, total: GAUNTLET_SIZE })}>
        {Array.from({ length: GAUNTLET_SIZE }, (_, i) => <span key={i} className={i < solved ? 'hit' : i === solved ? 'now' : ''} />)}
        <span className="guess-count">{solved} / {GAUNTLET_SIZE}</span>
      </p>
      <GauntletSolver key={puzzle.id} puzzle={puzzle} onFinished={() => { setSolved(s => s + 1); }} onNext={advance}
        last={solved + 1 >= GAUNTLET_SIZE} />
    </div>
  );
}

/** One puzzle of the gauntlet: the shared puzzle solver with a Continue button. */
function GauntletSolver({ puzzle, onFinished, onNext, last }: {
  puzzle: Puzzle; onFinished: () => void; onNext: () => void; last: boolean;
}) {
  const { t } = useTranslation('story');
  const toast = useToast();
  // A finished line reports the attempt to the shared rating.
  const { played, wrong, showHint, showMove, busy, finished, board, current, planning, solver, solverTurn, expected, clean, ...solve } = usePuzzleSolver(puzzle, {
    onSolve: ({ misses, hinted, revealed, seconds }) => {
      api<PuzzleAttempt>('api/puzzles/attempt', { id: puzzle.id, misses, hint: hinted, revealed, seconds })
        .catch(e => toast((e as Error).message));
      onFinished();
    },
  });

  const locked = finished || wrong !== null;
  const bar = finished
    ? <VerdictBar verdict={clean ? 'correct' : 'wrong'} title={clean ? t('gauntlet.nicelyDone') : t('gauntlet.withHelp')}
        primary={{ label: last ? t('gauntlet.finish') : t('gauntlet.next'), onClick: onNext }} />
    : wrong
      ? <VerdictBar verdict="wrong" title={t('gauntlet.tryAgain')}
          explanation={<Trans t={t} i18nKey="gauntlet.notTheMove" values={{ san: wrong }} components={{ strong: <strong /> }} />}
          primary={{ label: t('gauntlet.retry'), onClick: solve.clearWrong }} />
      : <VerdictBar primary={{ label: t('gauntlet.check'), onClick: () => undefined, disabled: true }}
          secondary={[
            ...(!showHint ? [{ label: t('gauntlet.showHint'), onClick: solve.hint }] : []),
            ...(!showMove ? [{ label: t('gauntlet.showMove'), onClick: solve.reveal }] : []),
          ]} />;

  return (
    <div className="lesson-layout">
      <div className="lesson-board-column">
        <div className={locked ? 'input-locked' : undefined}>
          <ChessBoard board={board} flipped={solver === 'black'} planning={planning}
            movable={!finished && !wrong && solverTurn && current ? 'turn' : false} onMove={solve.onMove} busy={busy}
            lastMove={played.at(-1)?.uci ?? null}
            annotations={showHint && expected ? [{ from: expected.uci.slice(0, 2), to: expected.uci.slice(0, 2) }] : []}
            bestMove={showMove && expected ? expected.uci : null} />
        </div>
      </div>
      <div className="lesson-panel" aria-live="polite">
        <Teacher pose={finished ? (clean ? 'clap' : 'thinking') : wrong ? 'confused' : 'puzzle'}>
          {finished
            ? clean ? t('gauntlet.clean') : t('gauntlet.helped')
            : <><strong>{t(`gauntlet.toMove.${solver}`)}</strong> {t('gauntlet.findBest')}</>}
        </Teacher>
        {showHint && expected && !finished && <p className="lesson-hint"><Trans t={t} i18nKey="gauntlet.hint" components={{ strong: <strong /> }} /></p>}
        {showMove && expected && !finished && <p className="lesson-hint"><Trans t={t} i18nKey="gauntlet.arrow" values={{ san: expected.san }} components={{ strong: <strong /> }} /></p>}
        {played.length > 1 && (
          <ol className="lesson-line" aria-label={t('gauntlet.movesSoFar')}>
            {played.slice(1).map((m, i) => <li key={i} className={i % 2 ? 'reply' : ''}>{moveLabel(puzzle.fen, i + 1, m.san)}</li>)}
          </ol>
        )}
      </div>
      {bar}
    </div>
  );
}

function Teacher({ pose, children }: { pose: Parameters<typeof Mascot>[0]['pose']; children: React.ReactNode }) {
  return (
    <div className="lesson-teacher">
      <Mascot pose={pose} size={96} />
      <div className="teacher-bubble">{children}</div>
    </div>
  );
}
