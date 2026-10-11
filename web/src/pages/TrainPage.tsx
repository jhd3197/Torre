// /train — drill the positions where you went wrong, scheduled with FSRS (drills.py).
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { ChessBoard } from '../components/ChessBoard';
import { TrainModes } from '../components/TrainModes';
import { TodayPlan, useTodayPlan } from '../components/TodayPlan';
import { ExplainMove } from '../components/CoachExplain';
import { usePosition } from '../hooks/useChess';
import { usePlanning } from '../hooks/usePlanning';
import { api } from '../lib/api';
import { displayDate, relativeTime } from '../lib/format';
import { explorePath, gamePath, lessonPath } from '../lib/routes';
import { useGameData, useToast } from '../state/AppData';
import type { DrillAnswer, DrillDeck } from '../types';

const NO_MOVES: never[] = [];

export function TrainPage() {
  const { t } = useTranslation('train');
  const toast = useToast();
  const { engineAvailable } = useGameData();
  const [deck, setDeck] = useState<DrillDeck | null>(null);
  const [answer, setAnswer] = useState<DrillAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // ?only=lessons: review just the exercises from lessons you finished.
  const [params] = useSearchParams();
  const lessonsOnly = params.get('only') === 'lessons';
  const card = deck?.card ?? null;
  const fromLesson = card?.source === 'lesson';
  const { board } = usePosition(card?.fen ?? '', NO_MOVES, !!card);
  const shown = card ? board : null;
  const planning = usePlanning(shown);
  const today = useTodayPlan(deck ? `${deck.due}/${deck.new}/${deck.learned}` : null);

  useEffect(() => { document.body.dataset.page = 'train'; }, []);

  const load = useCallback(async () => {
    setError(null);
    try { setDeck(await api<DrillDeck>(lessonsOnly ? 'api/drills?only=lessons' : 'api/drills')); setAnswer(null); } catch (e) { setError((e as Error).message); }
  }, [lessonsOnly]);
  useEffect(() => { void load(); }, [load]);

  async function play(uci: string) {
    if (!card || answer) return;
    setBusy(true);
    try { setAnswer(await api<DrillAnswer>('api/drills/answer', { id: card.id, move: uci, ...(lessonsOnly ? { only: 'lessons' } : {}) })); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }

  const next = () => { if (answer) { setDeck(answer.next); setAnswer(null); } };
  const counts = deck && (
    <dl className="train-counts">
      <div><dt>{t('counts.due')}</dt><dd>{deck.due}</dd></div>
      <div><dt>{t('counts.newToday')}</dt><dd>{deck.new}</dd></div>
      <div><dt>{t('counts.learned')}</dt><dd>{deck.learned} <small>{t('counts.ofTotal', { total: deck.total })}</small></dd></div>
      <div><dt>{t('counts.mastered')}</dt><dd>{deck.mastered ?? 0}</dd></div>
    </dl>
  );

  let content;
  if (error) content = <p className="train-empty" role="alert">{error} <button type="button" className="text-button" onClick={load}>{t('tryAgain')}</button></p>;
  else if (!deck) content = <p className="train-empty" role="status">{t('loading')}</p>;
  else if (!card) {
    content = (
      <div className="train-done">
        {deck.total ? <>
          <h2>{t('done.title')}</h2>
          <p>{deck.next_due ? t('done.nextReview', { when: relativeTime(deck.next_due) }) : t('done.comeBack')}
            {deck.new_total ? t('done.newWaiting', { count: deck.new_total, perDay: deck.new_per_day }) : ''}</p>
        </> : <>
          <h2>{t('empty.title')}</h2>
          <p>{t('empty.body')}</p>
        </>}
        {counts}
      </div>
    );
  } else {
    const side = card.fen.split(' ')[1] === 'b' ? 'Black' : 'White';
    const why = answer && ({ best: t('why.best'), mate: t('why.mate'), good: t('why.good', { move: answer.best_san }) } as Record<string, string>)[answer.verdict];
    content = (
      <div className="train-layout">
        <div className="train-board-column">
          <ChessBoard board={shown} flipped={side === 'Black'} planning={planning} movable={answer || !engineAvailable ? false : 'turn'} onMove={play}
            busy={busy} highlight={answer ? [answer.best.slice(0, 2), answer.best.slice(2, 4)] : []} bestMove={answer && !answer.correct ? answer.best : null} />
        </div>
        <aside className="train-panel" aria-live="polite">
          <p className="train-source">{fromLesson
            ? t('lessonSource', { title: card.lesson_title ?? card.lesson })
            : t('source', { opponent: card.opponent || t('unknownOpponent'), date: displayDate(card.date), move: card.move_number })}</p>
          {!answer ? (
            <p className="train-prompt"><Trans t={t} i18nKey={fromLesson ? (side === 'Black' ? 'prompt.lessonBlack' : 'prompt.lessonWhite')
              : card.mate ? (side === 'Black' ? 'prompt.mateBlack' : 'prompt.mateWhite')
              : side === 'Black' ? 'prompt.blackToMove' : 'prompt.whiteToMove'}
              values={{ class: card.class, count: card.mate }} components={{ strong: <strong /> }} />
              {!engineAvailable && t('prompt.noEngine')}</p>
          ) : <>
            {answer.correct
              ? <p className="train-verdict correct"><Trans t={t} i18nKey="verdict.correct" values={{ move: answer.san, why }} components={{ strong: <strong /> }} /></p>
              : <p className="train-verdict missed"><Trans t={t} i18nKey={answer.verdict === 'inaccuracy' ? 'verdict.missedAn' : 'verdict.missedA'}
                values={{ move: answer.san, verdict: answer.verdict, best: answer.best_san }} components={{ strong: <strong />, best: <strong /> }} /></p>}
            <p className="train-detail">{fromLesson ? t('lessonDetail', { when: relativeTime(answer.next_review) }) : t('detail', { played: answer.played, when: relativeTime(answer.next_review) })}</p>
            {answer.played && <ExplainMove fen={card.fen} move={answer.played} />}
            <div className="train-actions">
              <button className="button primary" type="button" onClick={next}>{t('actions.next')}</button>
              {fromLesson
                ? card.lesson && <Link className="text-button" to={lessonPath(card.lesson)}>{t('actions.lesson')}</Link>
                : <Link className="text-button" to={gamePath(answer.game_id, Math.max(0, answer.ply - 1))}>{t('actions.replay')}</Link>}
              <Link className="text-button" to={explorePath({ fen: card.fen, from: '/train' })}>{t('actions.explore')}</Link>
            </div>
          </>}
          {counts}
        </aside>
      </div>
    );
  }

  return (
    <section id="train" className="train" aria-label={t('page.label')}>
      <nav className="train-actions" aria-label={t('modes.label')}>
        {lessonsOnly
          ? <Link className="text-button" to="/train">{t('modes.everything')}</Link>
          : <Link className="text-button" to="/train?only=lessons">{t('modes.lessonsOnly')}</Link>}
        <Link className="text-button" to="/openings">{t('modes.openings')}</Link>
        <Link className="text-button" to="/endgames">{t('modes.endgames')}</Link>
      </nav>
      {content}
      {today && <TodayPlan plan={today} here />}
      <TrainModes />
    </section>
  );
}
