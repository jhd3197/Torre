import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { LessonCatalog } from '../../types';

/** The lesson catalog, with a retry for when it fails to load. */
export function useCatalog() {
  const [catalog, setCatalog] = useState<LessonCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setCatalog(await api<LessonCatalog>('api/lessons')); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { catalog, error, load };
}
