// The legends whose games are on disk (GET /api/masters), shared by the bot lobby, Play and the Arena.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { usePoll } from './usePoll';
import type { MasterInfo } from '../types';

/** The first-run download of every legend's games (masters.fill_missing), while the studio runs it. */
export interface MastersFill { running: boolean; done: number; total: number; current: string | null; failed: string[] }
export interface MastersList { masters: MasterInfo[]; missing: { id: string; name: string }[]; fill?: MastersFill }

/** Each legend's games take a while to download; checking more often shows nothing new. */
const FILL_POLL_MS = 4000;

let cached: MastersList | null = null;
let request: Promise<MastersList> | null = null;

function load(force = false): Promise<MastersList> {
  if (cached && !force) return Promise.resolve(cached);
  if (!request || force) {
    request = api<MastersList>('api/masters')
      .then(data => (cached = { masters: data.masters ?? [], missing: data.missing ?? [], fill: data.fill }))
      .catch(() => ({ masters: [], missing: [] }))  // no legends; everything else still works
      .finally(() => { request = null; });
  }
  return request;
}

/** Forget the list (tests start every render from a fresh server). */
export const resetMasters = () => { cached = null; request = null; };

export function useMasters() {
  const [list, setList] = useState<MastersList | null>(cached);
  const { schedule, signal } = usePoll();
  useEffect(() => {
    const live = signal();
    // While the studio fetches the legends in the background, check back so they appear as they land.
    const follow = (data: MastersList) => {
      if (live.aborted) return;
      setList(data);
      if (data.fill?.running) schedule(() => void load(true).then(follow), FILL_POLL_MS);
    };
    void load().then(follow);
  }, [schedule, signal]);
  const replace = useCallback((data: MastersList) => { cached = data; setList(data); }, []);
  return { masters: list?.masters ?? [], missing: list?.missing ?? [], fill: list?.fill, loaded: list !== null, replace };
}
