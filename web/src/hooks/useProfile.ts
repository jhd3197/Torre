// The player's XP and level (GET /api/profile), plus the event that refreshes them.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Profile } from '../types';

/** Fired on window when XP may have changed (a scored step completed); the header chip refetches. */
export const PROFILE_CHANGED = 'profile-changed';
export const refreshProfile = () => window.dispatchEvent(new Event(PROFILE_CHANGED));

export function useProfile(): Profile | null {
  const [profile, setProfile] = useState<Profile | null>(null);
  const load = useCallback(() => {
    api<Profile>('api/profile').then(setProfile).catch(() => { /* the chip just stays hidden */ });
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(PROFILE_CHANGED, load);
    return () => window.removeEventListener(PROFILE_CHANGED, load);
  }, [load]);
  return profile;
}
