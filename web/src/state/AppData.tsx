// App-wide data: the game library, cached insights, the background analysis job and toasts.
// Split into contexts by how often they change, so a component only re-renders for what it reads:
// - toast: the stable toast() action (never changes; boards and most pages need only this)
// - toast message: the visible toast text (changes on every toast, twice)
// - analysis: the background job's status (changes every 1.5 s while it runs)
// - game data: games, engines, insights (change on load and when analysis finishes)
// useAppData() still returns all of it merged, for components that genuinely need several.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import i18n from 'i18next';
import { api } from '../lib/api';
import { splashDone, splashStep } from '../lib/splash';
import { usePoll } from '../hooks/usePoll';
import type { AnalysisStatus, EngineInfo, GameSummary, InsightsData } from '../types';

/** Analysing one game takes a few seconds, so the banner's count needs no faster check. */
const ANALYSIS_POLL_MS = 1500;

export interface GameData {
  games: GameSummary[];
  gamesLoaded: boolean;
  gamesError: string | null;
  engineAvailable: boolean;
  /** The engine registry; empty until the first fetch lands. */
  engines: EngineInfo[];
  enginesLoaded: boolean;
  refreshEngines: () => Promise<void>;
  reloadGames: () => Promise<void>;
  /** undefined while loading; null when the archive has no games. */
  insights: InsightsData | null | undefined;
  insightsError: string | null;
  loadInsights: (force?: boolean) => void;
}

export interface AnalysisData {
  analysis: AnalysisStatus | null;
  startAnalysis: () => Promise<void>;
  stopAnalysis: () => Promise<void>;
  /** Fetch the job's status again (the studio may have started it on its own, after an import). */
  refreshAnalysis: () => Promise<void>;
  setAutoAnalysis: (enabled: boolean) => Promise<void>;
}

export type Toast = (message: string) => void;

interface AppData extends GameData, AnalysisData {
  toast: Toast;
  toastMessage: string | null;
}

const ToastContext = createContext<Toast | null>(null);
const ToastMessageContext = createContext<string | null>(null);
const AnalysisContext = createContext<AnalysisData | null>(null);
const GameDataContext = createContext<GameData | null>(null);

function required<T>(value: T | null, hook: string): T {
  if (!value) throw new Error(`${hook} must be used inside <AppDataProvider>.`);
  return value;
}

/** The stable toast action. Reading only this never re-renders on toasts or analysis polls. */
export function useToast(): Toast {
  return required(useContext(ToastContext), 'useToast');
}

/** The toast currently shown, or null. */
export function useToastMessage(): string | null {
  return useContext(ToastMessageContext);
}

/** The background analysis job and its actions. Re-renders on every status poll while it runs. */
export function useAnalysis(): AnalysisData {
  return required(useContext(AnalysisContext), 'useAnalysis');
}

/** Games, engines and insights, without the analysis status or toasts. */
export function useGameData(): GameData {
  return required(useContext(GameDataContext), 'useGameData');
}

/** Everything at once; re-renders on any change. Prefer the narrower hooks above. */
export function useAppData(): AppData {
  const toast = useToast();
  const toastMessage = useToastMessage();
  const analysis = useAnalysis();
  const data = useGameData();
  return useMemo(() => ({ ...data, ...analysis, toast, toastMessage }), [data, analysis, toast, toastMessage]);
}

/** Insights for the page, loading them on first use. */
export function useInsights() {
  const { insights, insightsError, loadInsights } = useGameData();
  useEffect(() => { if (insights === undefined && !insightsError) loadInsights(); }, [insights, insightsError, loadInsights]);
  return { insights, insightsError, retry: () => loadInsights(true) };
}

/** The engine registry, with the installed engines' ids for playability checks. */
export function useEngines() {
  const { engines, enginesLoaded } = useGameData();
  return useMemo(() => ({
    engines,
    loaded: enginesLoaded,
    installed: engines.filter(engine => engine.installed).map(engine => engine.id),
    byId: (id: string) => engines.find(engine => engine.id === id),
  }), [engines, enginesLoaded]);
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [gamesLoaded, setGamesLoaded] = useState(false);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [engineAvailable, setEngineAvailable] = useState(true);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [enginesLoaded, setEnginesLoaded] = useState(false);
  const [insights, setInsights] = useState<InsightsData | null | undefined>(undefined);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const insightsRequest = useRef<Promise<void> | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisStatus | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback((message: string) => {
    setToastMessage(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(null), 3600);
  }, []);

  const reloadGames = useCallback(async () => {
    try {
      const data = await api<{ games: GameSummary[]; engine: boolean }>('api/games');
      setGames(data.games);
      setEngineAvailable(data.engine);
      setGamesError(null);
    } catch (error) {
      setGamesError((error as Error).message);
    } finally {
      setGamesLoaded(true);
    }
  }, []);

  const loadInsights = useCallback((force = false) => {
    if (insightsRequest.current && !force) return;
    if (force) setInsights(undefined);
    setInsightsError(null);
    const request = api<InsightsData | null>('api/insights')
      .then(data => setInsights(data))
      .catch(() => setInsightsError('Could not load analysis. Please try again.'))
      .finally(() => { if (insightsRequest.current === request) insightsRequest.current = null; });
    insightsRequest.current = request;
  }, []);

  // Poll the analysis job while it runs; when it finishes, every statistic is stale.
  const { schedule, cancel, signal } = usePoll();
  const wasRunning = useRef(false);
  const refreshAnalysis = useCallback(async () => {
    cancel();
    const live = signal();
    let status: AnalysisStatus | null = null;
    try { status = await api<AnalysisStatus>('api/analysis', undefined, live); } catch { /* shown as no banner */ }
    if (live.aborted) return;
    setAnalysis(status);
    if (status?.running) {
      wasRunning.current = true;
      schedule(refreshAnalysis, ANALYSIS_POLL_MS);
    } else if (wasRunning.current) {
      wasRunning.current = false;
      loadInsights(true);
    }
  }, [loadInsights, cancel, schedule, signal]);

  const startAnalysis = useCallback(async () => {
    setAnalysis(await api<AnalysisStatus>('api/analysis/start', {}));
    await refreshAnalysis();
  }, [refreshAnalysis]);

  const stopAnalysis = useCallback(async () => {
    setAnalysis(await api<AnalysisStatus>('api/analysis/stop', {}));
    toast('Stopping after the current game.');
    await refreshAnalysis();
  }, [refreshAnalysis, toast]);

  const setAutoAnalysis = useCallback(async (enabled: boolean) => {
    setAnalysis(await api<AnalysisStatus>('api/settings/auto-analyze', { enabled }));
    await refreshAnalysis();
  }, [refreshAnalysis]);

  const loadEngines = useCallback(async () => {
    try {
      const data = await api<{ engines: EngineInfo[] }>('api/engines');
      setEngines(data.engines);
    } catch { /* the lab and extra bots stay hidden; Stockfish still works */ }
    finally { setEnginesLoaded(true); }
  }, []);

  useEffect(() => {
    reloadGames();
    loadEngines();
    refreshAnalysis();
    return () => clearTimeout(toastTimer.current);
  }, [reloadGames, loadEngines, refreshAnalysis]);

  // The launch splash (installed app only) waits for the library, which Home opens on.
  useEffect(() => {
    if (gamesLoaded) splashDone();
    else splashStep(i18n.t('nav:splash.games'));
  }, [gamesLoaded]);

  const gameData = useMemo<GameData>(() => ({
    games, gamesLoaded, gamesError, engineAvailable, engines, enginesLoaded, refreshEngines: loadEngines, reloadGames,
    insights, insightsError, loadInsights,
  }), [games, gamesLoaded, gamesError, engineAvailable, engines, enginesLoaded, loadEngines, reloadGames, insights, insightsError, loadInsights]);

  const analysisData = useMemo<AnalysisData>(() => ({
    analysis, startAnalysis, stopAnalysis, refreshAnalysis, setAutoAnalysis,
  }), [analysis, startAnalysis, stopAnalysis, refreshAnalysis, setAutoAnalysis]);

  return (
    <ToastContext.Provider value={toast}>
      <GameDataContext.Provider value={gameData}>
        <AnalysisContext.Provider value={analysisData}>
          <ToastMessageContext.Provider value={toastMessage}>{children}</ToastMessageContext.Provider>
        </AnalysisContext.Provider>
      </GameDataContext.Provider>
    </ToastContext.Provider>
  );
}
