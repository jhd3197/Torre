// One tooltip for the whole app. Any element with a `data-tip` attribute gets
// it — on hover after a short pause, at once on keyboard focus, on tap for
// touch — and Escape dismisses it. `data-tip-side="right"` puts the tip beside
// the trigger, for the folded rail whose icons have no room above.
import { useEffect, useRef, useState } from 'react';

const TIP_ID = 'app-tooltip';
const HOVER_DELAY = 350;
const GAP = 8;

interface Tip { text: string; rect: DOMRect; side: string | null }
interface Pos { top: number; left: number; below?: boolean; side?: string }

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const current = useRef<Element | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  useEffect(() => {
    const clear = () => {
      clearTimeout(timer.current);
      const el = current.current;
      if (el && el.getAttribute('aria-describedby') === TIP_ID) el.removeAttribute('aria-describedby');
      current.current = null;
      setTip(null);
    };
    const show = (el: Element) => {
      const text = el.getAttribute('data-tip');
      if (!text) return;
      if (current.current && current.current !== el) clear();
      current.current = el;
      // While it shows, the trigger is described by it unless it already
      // carries the same words as its own label.
      if (el.getAttribute('aria-label') !== text && !el.hasAttribute('aria-describedby')) {
        el.setAttribute('aria-describedby', TIP_ID);
      }
      setTip({ text, rect: el.getBoundingClientRect(), side: el.getAttribute('data-tip-side') });
    };
    const target = (node: EventTarget | null) => (node instanceof Element ? node.closest('[data-tip]') : null);

    const onOver = (e: PointerEvent) => {
      const el = target(e.target);
      if (!el || el === current.current) return;
      clearTimeout(timer.current);
      if (e.pointerType === 'touch') { show(el); return; }
      timer.current = setTimeout(() => show(el), HOVER_DELAY);
    };
    const onOut = (e: PointerEvent) => {
      const el = target(e.target);
      if (!el) return;
      if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
      if (e.pointerType === 'touch') return;
      clear();
    };
    const onFocus = (e: FocusEvent) => {
      const el = target(e.target);
      if (el && e.target instanceof Element && e.target.matches(':focus-visible')) show(el);
    };
    const onBlur = (e: FocusEvent) => {
      if (target(e.target) === current.current) clear();
    };
    const onDown = (e: PointerEvent) => {
      if (!target(e.target)) clear();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && current.current) clear(); };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', clear, true);
    window.addEventListener('resize', clear);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', clear, true);
      window.removeEventListener('resize', clear);
    };
  }, []);

  // Above the trigger, centred; below when there is no room; always inside
  // the viewport with a margin.
  useEffect(() => {
    if (!tip || !box.current) { setPos(null); return; }
    const { rect } = tip;
    const w = box.current.offsetWidth;
    const h = box.current.offsetHeight;
    const vw = document.documentElement.clientWidth;
    if (tip.side === 'right') {
      setPos({ top: rect.top + rect.height / 2 - h / 2, left: rect.right + GAP, side: 'right' });
      return;
    }
    let top = rect.top - h - GAP;
    let below = false;
    if (top < GAP) { top = rect.bottom + GAP; below = true; }
    const left = Math.min(Math.max(GAP, rect.left + rect.width / 2 - w / 2), vw - w - GAP);
    setPos({ top, left, below });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={box}
      id={TIP_ID}
      role="tooltip"
      className="app-tooltip"
      data-testid="tooltip"
      data-below={pos?.below ? 'true' : undefined}
      data-side={pos?.side}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
    >
      {tip.text}
    </div>
  );
}
