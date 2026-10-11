// Everything this browser keeps for Torre (settings, stars, the game in progress, story progress)
// as one JSON file, and back. Every key starts with `chess-jd-`; games and puzzles live in the studio.
const PREFIX = 'chess-jd-';

export interface Backup {
  app: 'torre';
  version: 1;
  saved: string;
  data: Record<string, string>;
}

function ownKeys(): string[] {
  try {
    return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((key): key is string => !!key?.startsWith(PREFIX));
  } catch {
    return [];
  }
}

/** A copy of everything stored, ready to save as a file. */
export function backup(now = new Date()): Backup {
  const data: Record<string, string> = {};
  for (const key of ownKeys()) {
    const value = localStorage.getItem(key);
    if (value !== null) data[key] = value;
  }
  return { app: 'torre', version: 1, saved: now.toISOString(), data };
}

/** The file's name: torre-backup-2026-10-11.json. */
export const backupName = (saved: string) => `torre-backup-${saved.slice(0, 10)}.json`;

/** Replace what is stored with a backup's contents; returns how many values were restored.
 *  Throws when the file is not a Torre backup, leaving storage as it was. */
export function restore(file: unknown): number {
  const parsed = file as Partial<Backup> | null;
  if (!parsed || parsed.app !== 'torre' || parsed.version !== 1 || typeof parsed.data !== 'object' || !parsed.data) {
    throw new Error('not a backup');
  }
  const entries = Object.entries(parsed.data).filter(([key, value]) => key.startsWith(PREFIX) && typeof value === 'string');
  for (const key of ownKeys()) localStorage.removeItem(key);
  for (const [key, value] of entries) localStorage.setItem(key, value);
  return entries.length;
}

/** Roughly how many bytes Torre keeps in this browser (storage counts two bytes a character). */
export function storageUsed(): number {
  return ownKeys().reduce((sum, key) => sum + (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2, 0);
}
