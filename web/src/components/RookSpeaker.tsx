// Rooky, the coach rook, saying a few recorded lines with captions: the Coach page briefing and the
// game recap. The bubble shows every line and lights the one being said; Rooky changes pose with
// each line while talking. With `autoKey`, the lines play on their own once per key (remembered in
// this browser), as long as the page was reached by a click: browsers keep audio quiet until the
// visitor has interacted, so a page opened straight from a link offers "Tap to hear" instead.
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Mascot, type MascotPose } from './Reward';
import { useNarration } from '../hooks/useNarration';
import { createSetting } from '../lib/settings';

/** Whether Rooky speaks first when the briefing or a recap opens (Settings). */
export const rookyAutoplay = createSetting<'on' | 'off'>('chess-jd-rooky-autoplay', 'on', ['on', 'off']);

const HEARD_KEY = 'chess-jd-rooky-heard';
const HEARD_KEPT = 200;
const TALKING: MascotPose[] = ['present', 'point', 'idea', 'nod'];

function heard(): string[] {
  try { const list = JSON.parse(localStorage.getItem(HEARD_KEY) ?? '[]'); return Array.isArray(list) ? list : []; } catch { return []; }
}
export function hasHeard(key: string) { return heard().includes(key); }
export function markHeard(key: string) {
  try { localStorage.setItem(HEARD_KEY, JSON.stringify([...heard().filter(k => k !== key), key].slice(-HEARD_KEPT))); } catch { /* storage unavailable */ }
}

/** True once the visitor has clicked or typed on the page, so audio may play. */
const mayPlay = () => (typeof navigator === 'undefined' || !('userActivation' in navigator) ? true
  : (navigator as Navigator & { userActivation: { hasBeenActive: boolean } }).userActivation.hasBeenActive);

export function RookSpeaker({ lines, pose = 'wave', autoKey, rate, size = 120, className = '', figure, children }: {
  lines: string[];
  pose?: MascotPose;
  /** Play once on its own for this key (a day's briefing, a game's recap). */
  autoKey?: string | null;
  rate?: number;
  size?: number;
  className?: string;
  /** Drawn in place of the posed mascot (the Coach page's cursor-watching rook). */
  figure?: ReactNode;
  /** Buttons under the bubble (start the session, open the lesson...). */
  children?: ReactNode;
}) {
  const { t } = useTranslation('rooky');
  const { speak, stop, speaking } = useNarration();
  const [part, setPart] = useState<number | null>(null);
  const [blocked, setBlocked] = useState(false);
  const started = useRef<string | null>(null);
  const text = lines.join('\n');

  const play = () => {
    setBlocked(false);
    speak({ parts: lines, rate, onPart: setPart }, () => setPart(null));
  };

  // Once per key and set of lines.
  const autoPlay = useEffectEvent(() => {
    if (!autoKey || !lines.length || started.current === autoKey || rookyAutoplay.get() === 'off' || hasHeard(autoKey)) return;
    started.current = autoKey;
    markHeard(autoKey);
    if (mayPlay()) play();
    else setBlocked(true);
  });
  useEffect(() => { autoPlay(); }, [autoKey, text]);


  if (!lines.length) return null;
  const talking = speaking && part !== null;
  const shownPose = talking && part! >= 0 ? TALKING[part! % TALKING.length] : pose;
  return (
    <div className={`rook-speaker${speaking ? ' is-speaking' : ''} ${className}`.trim()}>
      <button type="button" className="rook-speaker-mascot" onClick={() => (speaking ? stop() : play())}
        aria-label={speaking ? t('speaker.stop') : t('speaker.listen')} title={speaking ? t('speaker.stop') : t('speaker.listen')}>
        {figure ?? <Mascot pose={shownPose} size={size} />}
      </button>
      <div className="rook-speaker-bubble">
        <span className="rook-speaker-name">Rooky</span>
        <p aria-live="polite">
          {lines.map((line, i) => (
            <span key={`${i}:${line}`} className={talking && part! >= 0 ? (i === part ? 'now' : i < part! ? 'said' : 'later') : undefined}>{line} </span>
          ))}
        </p>
        <div className="rook-speaker-actions">
          <button type="button" className={`text-button rook-speaker-listen${blocked ? ' is-waiting' : ''}`} aria-pressed={speaking}
            onClick={() => (speaking ? stop() : play())}>
            {speaking ? `■ ${t('speaker.stop')}` : blocked ? `▶ ${t('speaker.tap')}` : `▶ ${t('speaker.listen')}`}
          </button>
          {children}
        </div>
      </div>
    </div>
  );
}
