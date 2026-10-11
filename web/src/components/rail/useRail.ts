// Collapse state for the side rail: folded on demand, a drawer on narrow
// screens, and a stored choice that survives reloads.
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { railFolded } from '../../lib/settings';

// Below this the rail leaves the flow and slides over the content.
const DRAWER_QUERY = '(max-width: 920px)';
// Laptop widths: the rail starts folded here until somebody chooses otherwise.
const COMPACT_QUERY = '(max-width: 1280px)';

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Whether the rail is open, folded, or — below 920px — a drawer.
 * With no stored choice the rail starts folded on a laptop-width screen.
 * A drawer is never the folded rail, and a route change closes it.
 */
export function useRail() {
  const { pathname } = useLocation();
  const narrow = useMedia(DRAWER_QUERY);
  const compact = useMedia(COMPACT_QUERY);
  const stored = railFolded.use();
  const [drawer, setDrawer] = useState(false);
  const collapsed = !narrow && (stored === '' ? compact : stored === '1');

  useEffect(() => { setDrawer(false); }, [pathname]);
  useEffect(() => { if (!narrow) setDrawer(false); }, [narrow]);

  const toggle = useCallback(() => railFolded.set(collapsed ? '0' : '1'), [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey || narrow) return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [narrow, toggle]);

  return {
    narrow,
    collapsed,
    drawer,
    // On a desk the rail folds; in a drawer the same control closes it.
    toggle: narrow ? () => setDrawer(false) : toggle,
    openDrawer: () => setDrawer(true),
    closeDrawer: () => setDrawer(false),
  };
}
