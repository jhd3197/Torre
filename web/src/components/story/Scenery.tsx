// The Story map's dressing: the trail joining the nodes, the scenery beside
// it, and the pop-in as things scroll into view. All decorative: hidden from
// assistive tech, no pointer events.
import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { trailPath, type Decor, type PathLayout } from '../../lib/storyScenery';

export function SceneryItem({ decor }: { decor: Decor }) {
  const style = (decor.kind === 'edge' ? {} : { left: decor.x, top: decor.y }) as CSSProperties;
  return (
    <img className={`scenery scenery-${decor.kind} scenery-${decor.side} reveal${decor.flip ? ' flip' : ''}`}
      src={decor.src} alt="" aria-hidden="true" loading="lazy" style={style} />
  );
}

/** The dashed trail: walked up to the current node in the chapter's colour, grey beyond. */
export function PathTrail({ layout, walked }: { layout: PathLayout; walked: number }) {
  const last = layout.points.length - 1;
  if (last < 1) return null;
  const split = Math.max(0, Math.min(walked, last));
  return (
    <svg className="path-trail" width={layout.width} height={layout.height} aria-hidden="true">
      {split < last && <path className="trail-todo" d={trailPath(layout, split, last)} />}
      {split > 0 && <path className="trail-done" d={trailPath(layout, 0, split)} />}
    </svg>
  );
}

/** The element's content width, tracked as it resizes (a fallback before layout, and in tests). */
export function useWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => { if (el.clientWidth > 0) setWidth(el.clientWidth); };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Adds `.in` to each `.reveal` under the root as it scrolls into view (once). */
export function useReveal(root: RefObject<HTMLElement | null>, ready: unknown) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const targets = [...el.querySelectorAll<HTMLElement>('.reveal:not(.in)')];
    if (typeof IntersectionObserver === 'undefined') { targets.forEach(t => t.classList.add('in')); return; }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -6% 0px' });
    targets.forEach(t => observer.observe(t));
    return () => observer.disconnect();
  }, [root, ready]);
}
