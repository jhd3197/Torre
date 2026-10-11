// A segmented control whose highlight slides to the chosen option. The options
// are plain buttons with aria-pressed; this only measures the pressed one and
// hands its box to CSS (`.bots-segments::before` in _controls.scss).
import { useLayoutEffect, useRef, type HTMLAttributes } from 'react';

export function Segments({ className = 'bots-segments', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);

  // Runs after every render, so a new choice moves the pill on the same frame.
  useLayoutEffect(() => {
    const box = ref.current;
    if (box) place(box);
  });

  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    // The first placement and every resize land without animating; only a
    // change of choice slides.
    const frame = requestAnimationFrame(() => box.setAttribute('data-ready', ''));
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(frame);
    const resize = new ResizeObserver(() => {
      box.removeAttribute('data-ready');
      place(box);
      requestAnimationFrame(() => box.setAttribute('data-ready', ''));
    });
    resize.observe(box);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); };
  }, []);

  return <div ref={ref} className={className} {...rest}>{children}</div>;
}

function place(box: HTMLElement) {
  const on = box.querySelector<HTMLElement>(':scope > [aria-pressed="true"]');
  box.style.setProperty('--seg-on', on ? '1' : '0');
  if (!on) return;
  box.style.setProperty('--seg-x', `${on.offsetLeft}px`);
  box.style.setProperty('--seg-y', `${on.offsetTop}px`);
  box.style.setProperty('--seg-w', `${on.offsetWidth}px`);
  box.style.setProperty('--seg-h', `${on.offsetHeight}px`);
}
