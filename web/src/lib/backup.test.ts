import { backup, backupName, restore, storageUsed } from './backup';

test('a backup holds what Torre stores, and restoring it replaces what is there', () => {
  localStorage.setItem('chess-jd-piece-set', 'clay');
  localStorage.setItem('chess-jd-stars-v1', '{"baron-blunder":3}');
  localStorage.setItem('someone-else', 'keep');
  const saved = backup(new Date('2026-10-11T12:00:00Z'));
  expect(saved.data).toEqual({ 'chess-jd-piece-set': 'clay', 'chess-jd-stars-v1': '{"baron-blunder":3}' });
  expect(backupName(saved.saved)).toBe('torre-backup-2026-10-11.json');

  localStorage.setItem('chess-jd-piece-set', 'classic');
  localStorage.setItem('chess-jd-music', 'off');
  expect(restore(JSON.parse(JSON.stringify(saved)))).toBe(2);
  expect(localStorage.getItem('chess-jd-piece-set')).toBe('clay');
  expect(localStorage.getItem('chess-jd-music')).toBeNull();
  expect(localStorage.getItem('someone-else')).toBe('keep');
  expect(storageUsed()).toBeGreaterThan(0);
});

test('a file that is not a backup changes nothing', () => {
  localStorage.setItem('chess-jd-piece-set', 'clay');
  for (const file of [null, {}, { app: 'torre', version: 2, data: {} }, { app: 'other', version: 1, data: {} }]) {
    expect(() => restore(file)).toThrow();
  }
  expect(localStorage.getItem('chess-jd-piece-set')).toBe('clay');
  // Only Torre's own keys and text values come back from a backup.
  restore({ app: 'torre', version: 1, saved: '', data: { 'chess-jd-a': '1', other: 'x', 'chess-jd-b': 2 } });
  expect(localStorage.getItem('chess-jd-a')).toBe('1');
  expect(localStorage.getItem('other')).toBeNull();
  expect(localStorage.getItem('chess-jd-b')).toBeNull();
});
