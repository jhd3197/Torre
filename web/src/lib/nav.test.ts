import { DEFAULT_NAV, hiddenNavItems, moveNavItem, navOrder, NAV_ITEMS, placeNavItem } from './nav';

test('moving a link steps it one place, and stops at either end', () => {
  expect(moveNavItem(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
  expect(moveNavItem(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
  expect(moveNavItem(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
  expect(moveNavItem(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
});

test('a dropped link lands before the one it was dropped on, or at the end', () => {
  expect(placeNavItem(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  expect(placeNavItem(['a', 'b', 'c', 'd'], 'a', 'd')).toEqual(['b', 'c', 'a', 'd']);
  expect(placeNavItem(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
});

test('the sidebar starts with the seven main pages; the rest wait to be added', () => {
  expect(navOrder.get()).toBe(DEFAULT_NAV.join(','));
  expect(hiddenNavItems(DEFAULT_NAV).map(item => item.key)).toEqual(['games', 'explore', 'train', 'openings', 'endgames', 'insights', 'awards', 'import', 'settings']);
  expect(new Set(NAV_ITEMS.map(item => item.key)).size).toBe(NAV_ITEMS.length);
  localStorage.setItem('chess-jd-nav', 'home,nope');
  navOrder.reset();
  expect(navOrder.get()).toBe(DEFAULT_NAV.join(','));
});
