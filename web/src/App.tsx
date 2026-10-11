import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, type RouteObject } from 'react-router-dom';
import { appBasename } from './lib/base';
import { startPage, type StartPage } from './lib/settings';
import { Layout, type RouteHandle } from './components/Layout';
import { contentSettled } from './i18n';
import { PageLoading } from './components/PageLoading';
import { AppDataProvider } from './state/AppData';
import { PromotionProvider } from './state/Promotion';
import { FirstRun } from './components/Welcome';
import { Captions } from './components/Captions';

/** A page loaded on first visit: each route is its own chunk. Waits for the content namespace too
 *  when the page's modules asked for it (bots, openings, story), so its copy renders translated. */
type PropsOf<C> = C extends ComponentType<infer P> ? P : never;
const pageLoaders: (() => Promise<unknown>)[] = [];
function page<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  type Page = ComponentType<PropsOf<M[K]>>;
  let loaded: Page | null = null;
  const fetchPage = async () => {
    const module = await load();
    await contentSettled();
    loaded = module[name] as unknown as Page;
    return loaded;
  };
  pageLoaders.push(fetchPage);
  // Once fetched (preloadPages), hand React an already-settled thenable so the page renders
  // without suspending.
  return lazy(() => (loaded
    ? { then: (resolve: (module: { default: Page }) => void) => resolve({ default: loaded! }) }
    : fetchPage().then(component => ({ default: component }))) as Promise<{ default: Page }>);
}

/** Fetch every page chunk now (tests; or warming the cache when idle). */
export const preloadPages = () => Promise.all(pageLoaders.map(load => load()));

const ArenaPage = page(() => import('./pages/ArenaPage'), 'ArenaPage');
const AwardsPage = page(() => import('./pages/AwardsPage'), 'AwardsPage');
const BotsHomePage = page(() => import('./pages/BotsHomePage'), 'BotsHomePage');
const BotCollectionPage = page(() => import('./pages/BotCollectionPage'), 'BotCollectionPage');
const ExplorePage = page(() => import('./pages/ExplorePage'), 'ExplorePage');
const GamePage = page(() => import('./pages/GamesPage'), 'GamePage');
const GamesIndex = page(() => import('./pages/GamesPage'), 'GamesIndex');
const HomePage = page(() => import('./pages/HomePage'), 'HomePage');
const ImportPage = page(() => import('./pages/ImportPage'), 'ImportPage');
const CoachPage = page(() => import('./pages/CoachPage'), 'CoachPage');
const InsightsPage = page(() => import('./pages/InsightsPage'), 'InsightsPage');
const LessonFocusGate = page(() => import('./pages/StoryPage'), 'LessonFocusGate');
const StoryBossPage = page(() => import('./pages/StoryPage'), 'StoryBossPage');
const StoryGauntletPage = page(() => import('./pages/StoryPage'), 'StoryGauntletPage');
const StoryLessonEntry = page(() => import('./pages/StoryPage'), 'StoryLessonEntry');
const StoryPage = page(() => import('./pages/StoryPage'), 'StoryPage');
const PlayPage = page(() => import('./pages/PlayPage'), 'PlayPage');
const ProfilePage = page(() => import('./pages/ProfilePage'), 'ProfilePage');
const PuzzlesPage = page(() => import('./pages/PuzzlesPage'), 'PuzzlesPage');
const SettingsPage = page(() => import('./pages/SettingsPage'), 'SettingsPage');
const StagePage = page(() => import('./pages/StagePage'), 'StagePage');
const TrainPage = page(() => import('./pages/TrainPage'), 'TrainPage');
const OpeningsPage = page(() => import('./pages/OpeningsPage'), 'OpeningsPage');
const EndgamesPage = page(() => import('./pages/EndgamesPage'), 'EndgamesPage');
const GuessMovePage = page(() => import('./pages/TrainerPages'), 'GuessMovePage');
const MistakesPage = page(() => import('./pages/TrainerPages'), 'MistakesPage');

/** Shell-less routes have no Layout around them, so they bring their own loading boundary. */
const bareLoading = (element: ReactNode) => <Suspense fallback={<PageLoading />}>{element}</Suspense>;

/** Where each start page choice opens. */
const START_PATHS: Record<Exclude<StartPage, 'home'>, string> = { story: '/story', play: '/play', puzzles: '/puzzles', coach: '/coach' };
let launched = false;
/** Home, unless the app was just opened and Settings names another start page: then that page, once. */
function HomeEntry() {
  const first = !launched && ((window.history.state as { idx?: number } | null)?.idx ?? 0) === 0;
  launched = true;
  const start = startPage.get();
  return first && start !== 'home' ? <Navigate to={START_PATHS[start]} replace /> : <HomePage />;
}

const handle = (title: string, actions: RouteHandle['actions'] = []): RouteHandle => ({ title, actions });
// Pages whose own hero or header already names them: no shared top bar.
const bare = (title: string): RouteHandle => ({ title, topbar: false });

export const routes: RouteObject[] = [{
  element: <Layout />,
  children: [
    { index: true, element: <HomeEntry />, handle: bare('Home') },
    { path: 'play', element: <PlayPage />, handle: handle('Play', ['new-game']) },
    { path: 'play/bots', element: <BotsHomePage />, handle: bare('Bots') },
    { path: 'play/bots/:id', element: <BotCollectionPage />, handle: bare('Bots') },
    { path: 'games', element: <GamesIndex />, handle: handle('Games', ['import']) },
    { path: 'games/:id/:ply?', element: <GamePage />, handle: handle('Games', ['import']) },
    { path: 'explore', element: <ExplorePage />, handle: handle('Explore') },
    { path: 'import', element: <ImportPage />, handle: handle('Import') },
    { path: 'train', element: <TrainPage />, handle: handle('Train') },
    { path: 'openings', element: <OpeningsPage />, handle: handle('Openings') },
    { path: 'endgames/:id?', element: <EndgamesPage />, handle: handle('Endgames') },
    { path: 'train/mistakes/:id', element: <MistakesPage />, handle: handle('Train') },
    { path: 'train/guess/:master?/:game?', element: <GuessMovePage />, handle: handle('Train') },
    { path: 'puzzles', element: <PuzzlesPage />, handle: bare('Puzzles') },
    { path: 'puzzles/:theme/:id?', element: <PuzzlesPage />, handle: handle('Puzzles') },
    { path: 'arena', element: <ArenaPage />, handle: bare('Arena') },
    // The Engine Lab became the Engines section of Settings; the Arena moved to /arena.
    { path: 'engines', element: <Navigate to="/settings/engines" replace /> },
    { path: 'engines/arena', element: <Navigate to="/arena" replace /> },
    { path: 'story', element: <StoryPage />, handle: bare('Story') },
    { path: 'profile', element: <ProfilePage />, handle: bare('Profile') },
    // The gate keeps story lessons at their /lessons URLs but swaps in focus mode.
    { path: 'lessons/:slug?/:step?', element: <LessonFocusGate />, handle: handle('Lessons') },
    { path: 'awards', element: <AwardsPage />, handle: handle('Awards') },
    { path: 'settings/:section?', element: <SettingsPage />, handle: bare('Settings') },
    { path: 'coach', element: <CoachPage />, handle: bare('Coach') },
    { path: 'coach/progress/:section?', element: <CoachPage mode="progress" />, handle: bare('Coach') },
    { path: 'coach/learn', element: <CoachPage mode="learn" />, handle: bare('Coach') },
    { path: 'insights/:section?', element: <InsightsPage />, handle: handle('Insights') },
    { path: '*', element: <Navigate to="/" replace /> },
  ],
}, {
  // Focus mode: story nodes render without the app shell (no rail, no header).
  path: 'story/lesson/:slug/:step?',
  element: bareLoading(<StoryLessonEntry />),
}, {
  path: 'story/gauntlet/:chapterId',
  element: bareLoading(<StoryGauntletPage />),
}, {
  path: 'story/boss/:chapterId',
  element: bareLoading(<StoryBossPage />),
}, {
  // The YouTube set, driven by the video recorder (see pages/StagePage.tsx).
  path: 'stage',
  element: bareLoading(<StagePage />),
}];

const router = createBrowserRouter(routes, { basename: appBasename() });

export function App() {
  return (
    <AppDataProvider>
      <PromotionProvider>
        <RouterProvider router={router} />
        <FirstRun />
        <Captions />
      </PromotionProvider>
    </AppDataProvider>
  );
}
