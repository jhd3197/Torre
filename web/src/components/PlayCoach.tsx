// Rooky, the coach bot: it plays you and talks you through the game. On your turn it reads the
// position once and speaks up on its own when something big is there (a mate for you, a threat of
// its own worth seeing); the rest is on request, a rung at a time: the idea, then the piece, then
// the move, and what it threatens. The word before a mistake comes from the play page, which
// checks each move before it is played. Everything said is shown too; the quiet coach only shows.
import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Mascot } from './Reward';
import { coachHint, type CoachHint, type CoachMove } from '../hooks/useChess';
import { useNarration } from '../hooks/useNarration';
import { quietCoach } from '../lib/settings';
import type { LessonMark, Move } from '../types';

export interface CoachMarks { highlight?: string[]; arrow?: string | null; annotations?: LessonMark[] }

const isMate = (motifs: string[]) => motifs.some(m => m.startsWith('mateIn') || m === 'backRankMate');

/** The first rung: what kind of move to look for, from the tactics the best move carries. */
export function nudgeFor(t: TFunction<'play'>, best: CoachMove | null) {
  const motifs = best?.motifs ?? [];
  if (isMate(motifs)) return t('coach.nudge.mate');
  if (motifs.includes('fork')) return t('coach.nudge.fork');
  if (motifs.includes('hangingPiece')) return t('coach.nudge.free');
  if (motifs.includes('promotion')) return t('coach.nudge.promotion');
  return t('coach.nudge.general');
}

/** What the coach threatens, in a sentence. */
export function threatLine(t: TFunction<'play'>, threat: CoachHint['threat'], bot: string) {
  if (!threat) return t('coach.threat.none', { bot });
  if (isMate(threat.motifs)) return t('coach.threat.mate', { bot, san: threat.san });
  if (threat.motifs.includes('fork')) return t('coach.threat.fork', { bot, san: threat.san });
  return t('coach.threat.material', { bot, san: threat.san });
}

/** What Rooky says unasked when your turn comes: a threat worth stopping first, then a big chance. */
export function unaskedLine(t: TFunction<'play'>, hint: CoachHint, bot: string): string | null {
  const threat = hint.threat;
  if (threat && (isMate(threat.motifs) || threat.gain >= 3)) return t('coach.unasked.threat', { bot });
  const motifs = hint.best?.motifs ?? [];
  if (isMate(motifs)) return t('coach.unasked.mate');
  if (motifs.includes('hangingPiece') || motifs.includes('fork')) return t('coach.unasked.chance');
  return null;
}

export function PlayCoach({ initialFen, moves, yourTurn, botName, onMarks }: {
  initialFen: string; moves: Move[]; yourTurn: boolean; botName: string; onMarks: (marks: CoachMarks) => void;
}) {
  const { t } = useTranslation('play');
  const [hint, setHint] = useState<CoachHint | null>(null);
  const [rung, setRung] = useState(0);
  const [threat, setThreat] = useState(false);
  const [unasked, setUnasked] = useState<string | null>(null);
  const quiet = quietCoach.use();
  const voice = useNarration();
  const count = moves.length;
  const speak = (line: string) => { if (!quiet) voice.speak({ narration: line }); };
  const say = useEffectEvent(speak);

  // Your turn: read the position once (it serves every rung), and speak up when it matters.
  useEffect(() => {
    setHint(null); setRung(0); setThreat(false); setUnasked(null);
    if (!yourTurn) return;
    const controller = new AbortController();
    coachHint(initialFen, moves, controller.signal).then(found => {
      setHint(found);
      const line = count === 0 ? t('coach.hello') : unaskedLine(t, found, botName);
      setUnasked(line);
      if (line) say(line);
    }, () => { /* the coach stays quiet when the engine is away */ });
    return () => controller.abort();
    // `moves` changes with `count`; reading it again would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, yourTurn, initialFen]);

  // The board shows the rung reached: the piece circled, then the move; the threat as its own arrow.
  useEffect(() => {
    const best = hint?.best;
    const shownThreat = threat ? hint?.threat : null;
    onMarks({
      highlight: best && rung === 2 ? [best.uci.slice(0, 2)] : [],
      arrow: best && rung >= 3 ? best.uci : null,
      annotations: shownThreat ? [{ from: shownThreat.uci.slice(0, 2), to: shownThreat.uci.slice(2, 4) }] : [],
    });
  }, [hint, rung, threat, onMarks]);
  useEffect(() => () => onMarks({}), [onMarks]);

  const best = hint?.best ?? null;
  const rungLine = (n: number) => n === 1 ? nudgeFor(t, best) : n === 2 && best ? t('coach.piece', { piece: t(`coach.pieces.${best.piece}`) })
    : n === 3 && best ? t('coach.move', { san: best.san }) : '';
  const lines = [unasked, ...[1, 2, 3].filter(n => rung >= n).map(rungLine), threat && hint ? threatLine(t, hint.threat, botName) : null]
    .filter(Boolean) as string[];

  function climb() {
    if (!hint) return;
    const next = rung + 1;
    setRung(next);
    speak(rungLine(next));
  }
  function toggleThreat() {
    if (!hint) return;
    if (!threat) speak(threatLine(t, hint.threat, botName));
    setThreat(on => !on);
  }

  if (!yourTurn) return (
    <div className="play-coach waiting" aria-live="polite">
      <div className="play-coach-head"><Mascot pose="thinking" size={44} /><p>{t('coach.myMove', { bot: botName })}</p></div>
    </div>
  );
  return (
    <div className="play-coach" aria-live="polite">
      <div className="play-coach-head">
        <Mascot pose={threat && hint?.threat ? 'alarm' : unasked && !rung ? 'point' : rung ? 'pointer' : 'thinking'} size={44} />
        <p>{lines.length ? lines.at(-1) : t('coach.ready')}</p>
      </div>
      {lines.length > 1 && <ul className="play-coach-lines">{lines.slice(0, -1).map(line => <li key={line}>{line}</li>)}</ul>}
      <div className="play-coach-actions">
        {rung < 3 && (
          <button type="button" className="text-button" disabled={!hint} onClick={climb}>
            {rung === 0 ? t('coach.hint') : rung === 1 ? t('coach.whichPiece') : t('coach.showMove')}
          </button>
        )}
        <button type="button" className="text-button" disabled={!hint} aria-pressed={threat} onClick={toggleThreat}>
          {threat ? t('coach.hideThreat') : t('coach.threatButton')}
        </button>
      </div>
    </div>
  );
}
