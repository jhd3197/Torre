// The rook that watches the cursor. Its resting frame is a faceless body with the eyes drawn on
// top, so they can follow the pointer to any angle; hovering, clicking, circling it, leaving it alone
// or leaving the window swap in a whole reaction sprite (art/mascot/cursor, registered on the base).
import { useEffect, useRef, useState, type CSSProperties } from 'react';

/** Frames with no face: the app draws the eyes. */
type BodyFrame = 'body' | 'body-reach' | 'body-arms-up' | 'body-hips' | 'body-crossed';
/** Frames with the face painted in. */
type ReactionFrame = 'tickled' | 'boop' | 'startled' | 'hello' | 'dizzy' | 'doze' | 'wake' | 'bye';
export type RookFrame = BodyFrame | ReactionFrame;

const FRAMES: RookFrame[] = ['body', 'body-reach', 'body-arms-up', 'body-hips', 'body-crossed',
  'tickled', 'boop', 'startled', 'hello', 'dizzy', 'doze', 'wake', 'bye'];
const src = (frame: RookFrame) => `art/mascot/cursor/${frame}.webp`;
const hasFace = (frame: RookFrame) => !frame.startsWith('body');

// The face, in the frames' 384px space (measured on the painted "look" frame, same registration).
const VIEW = 384;
const FACE = { x: 191.5, y: 178 };
const EYE = { dx: 28.5, rx: 9, ry: 13.5 };
const MOUTH_Y = 204;
/** How far the eyes can travel from centre, and the tilt toward the pointer at most. */
const REACH = { x: 15, y: 11 };
const MAX_TILT = 6;

/** Leave it alone this long and it dozes off. */
export const DOZE_MS = 20_000;
/** Whole turns of the pointer around it, within DIZZY_WINDOW_MS, that make it dizzy. */
const DIZZY_TURNS = 2;
const DIZZY_WINDOW_MS = 3_000;
/** How fast the pointer has to close in, in px a second, to startle it. */
const RUSH = 2_500;

/** The eyes' offset for a pointer `dx`, `dy` (CSS px) from the face: the direction, eased in over ~300px. */
export function gaze(dx: number, dy: number): { x: number; y: number } {
  const distance = Math.hypot(dx, dy);
  if (!distance) return { x: 0, y: 0 };
  const pull = Math.min(1, distance / 300);
  return { x: (dx / distance) * REACH.x * pull, y: (dy / distance) * REACH.y * pull };
}

/** The tilt toward the pointer, in degrees: a little lean, never a fall. */
export function tilt(dx: number): number {
  return Math.max(-MAX_TILT, Math.min(MAX_TILT, dx / 120));
}

/** The resting body for where the pointer is: arms out when it comes close, up when it is close above. */
export function bodyFor(dx: number, dy: number, size: number): BodyFrame {
  if (Math.hypot(dx, dy) > size * 1.4) return 'body';
  return dy < -size * 0.45 ? 'body-arms-up' : 'body-reach';
}

export function CursorRook({ size = 140, className = '' }: { size?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0, tilt: 0, body: 'body' as BodyFrame });
  const [reaction, setReaction] = useState<ReactionFrame | null>(null);
  const [blinking, setBlinking] = useState(false);
  const [fidget, setFidget] = useState<BodyFrame | null>(null);
  const [hovered, setHovered] = useState(false);
  const state = useRef({ away: false, dozing: false, lastMove: Date.now(), angle: null as number | null, turned: 0, turnStart: 0, near: Infinity, nearAt: 0 });
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    const later = (ms: number, run: () => void) => { pending.push(window.setTimeout(run, ms)); };
    const react = (frame: ReactionFrame | null, ms?: number) => {
      setReaction(frame);
      if (ms) later(ms, () => setReaction(current => current === frame ? null : current));
    };
    const s = state.current;
    let frame = 0;

    function onMove(event: PointerEvent) {
      const now = Date.now();
      s.lastMove = now;
      if (s.away) { s.away = false; react('hello', 1200); }
      if (s.dozing) { s.dozing = false; react('wake', 900); }
      setFidget(null);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = ref.current?.getBoundingClientRect();
        if (!box || !box.width) return;
        const scale = box.width / VIEW;
        const dx = event.clientX - (box.left + FACE.x * scale), dy = event.clientY - (box.top + FACE.y * scale);
        const eyes = gaze(dx, dy);
        setLook({ ...eyes, tilt: tilt(dx), body: bodyFor(dx, dy, box.width) });
        // Circling: add up the turn of the pointer around the face; two whole turns in a few seconds is too much.
        const angle = Math.atan2(dy, dx);
        if (s.angle !== null && Math.hypot(dx, dy) < box.width * 3) {
          let step = angle - s.angle;
          if (step > Math.PI) step -= 2 * Math.PI;
          if (step < -Math.PI) step += 2 * Math.PI;
          if (now - s.turnStart > DIZZY_WINDOW_MS) { s.turned = 0; s.turnStart = now; }
          s.turned += step;
          if (Math.abs(s.turned) > DIZZY_TURNS * 2 * Math.PI) { s.turned = 0; react('dizzy', 2200); }
        }
        s.angle = angle;
        // Rushing at it: the gap closing faster than RUSH px/s once the pointer is close.
        const near = Math.hypot(dx, dy);
        if (near < box.width * 2 && s.nearAt && (s.near - near) / Math.max(1, now - s.nearAt) * 1000 > RUSH) react('startled', 700);
        s.near = near;
        s.nearAt = now;
      });
    }
    function onLeave(event: PointerEvent) {
      if (event.relatedTarget) return;
      s.away = true;
      react('bye');
    }
    // Every second: doze off when left alone, fidget now and then when the pointer rests.
    const tick = window.setInterval(() => {
      const still = Date.now() - s.lastMove;
      if (!s.dozing && !s.away && still > DOZE_MS) { s.dozing = true; react('doze'); }
      else if (!s.dozing && still > 4000 && Math.random() < 0.12) {
        setFidget(Math.random() < 0.5 ? 'body-hips' : 'body-crossed');
        later(2500, () => setFidget(null));
      }
    }, 1000);
    // Blink every few seconds, sometimes twice.
    let blinkTimer = 0;
    const blink = () => {
      setBlinking(true);
      later(130, () => setBlinking(false));
      if (Math.random() < 0.2) later(300, () => { setBlinking(true); later(130, () => setBlinking(false)); });
      blinkTimer = window.setTimeout(blink, 2500 + Math.random() * 3500);
    };
    blinkTimer = window.setTimeout(blink, 1500 + Math.random() * 2000);

    window.addEventListener('pointermove', onMove);
    document.documentElement.addEventListener('pointerleave', onLeave);
    // Load every frame up front, so a reaction never flashes an empty box.
    FRAMES.forEach(name => { const image = new Image(); image.src = src(name); });
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.clearInterval(tick);
      window.clearTimeout(blinkTimer);
      pending.forEach(window.clearTimeout);
      cancelAnimationFrame(frame);
    };
  }, []);

  const shown: RookFrame = reaction ?? (hovered ? 'tickled' : fidget ?? look.body);
  const face = !hasFace(shown);
  return (
    <span ref={ref} className={`cursor-rook ${className}`.trim()} aria-hidden="true"
      style={{ width: size, height: size, '--rook-tilt': `${face ? look.tilt : 0}deg` } as CSSProperties}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={() => setReaction('boop')}
      onPointerUp={() => {
        timers.current.push(window.setTimeout(() => setReaction(current => current === 'boop' ? null : current), 350));
      }}>
      <img src={src(shown)} alt="" width={size} height={size} draggable={false} />
      {face && (
        <svg viewBox={`0 0 ${VIEW} ${VIEW}`} width={size} height={size}>
          <g className="cursor-rook-eyes" style={{ transform: `translate(${look.x}px, ${look.y}px)` }}>
            {[-1, 1].map(side => (
              <ellipse key={side} cx={FACE.x + side * EYE.dx} cy={FACE.y} rx={EYE.rx} ry={blinking ? 1.5 : EYE.ry} />
            ))}
            <path d={`M ${FACE.x - 12} ${MOUTH_Y - 3} Q ${FACE.x} ${MOUTH_Y + 7} ${FACE.x + 12} ${MOUTH_Y - 3}`} />
          </g>
        </svg>
      )}
    </span>
  );
}
