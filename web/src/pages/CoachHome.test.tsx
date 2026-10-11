import { fireEvent, screen, waitFor } from '@testing-library/react';
import { fakeServer, renderAt } from '../test/harness';
import type { CoachHomeData, FocusRow } from '../components/CoachHome';

const fork: FocusRow = {
  skill: 'fork', family: 'tactics', name: 'forks', title: 'Forks', idea: 'A fork is one piece attacking two targets at once.',
  mastery: 42, confidence: 0.9, trend: 'worse', events: 30, week: { ok: 1, missed: 2, games_missed: 2 },
  evidence: [{ src: 'game', at: '2026-10-09T10:00:00+00:00', ref: { game: '77', ply: 27, opponent: 'Duke-BOT' } }],
  since: '2026-10-08', start: 40, pinned: false, themes: ['fork'], lessons: ['knight-fork'],
  fresh: { count: 4, ok: 3, pct: 75 }, goal: { count: 6, pct: 75 },
};

const HOME: CoachHomeData = {
  day: '2026-10-10',
  briefing: ["Hi, it's Rooky!", "Right now, we're working on forks.", "Your session is ready. Let's go!"],
  focus: [fork],
  session: { slug: 'session-2026-10-10-fork', title: 'Forks', skill: 'fork', steps: 8, minutes: 8, step: 0, completed: null,
    kinds: ['explain', 'explain', 'play', 'play', 'play', 'play', 'play', 'explain'] },
  changes: [], graduated: [],
  skills: [{ ...fork }],
  games: [{ slug: 'game-77', game: '77', opponent: 'Duke-BOT', date: '2026.10.09', result: 0, color: 'white', moments: 2,
    skills: ['fork'], completed: null, step: 0 }],
  hasGames: true,
};

describe('Coach plan', () => {
  test('Rooky briefs you, and the plan links the session, the focus and the lessons from your games', async () => {
    const server = fakeServer();
    server.on('api/coach/home', () => HOME);
    renderAt('/coach');
    expect(await screen.findByText("Right now, we're working on forks.", { exact: false })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Start the session' })[0]).toHaveAttribute('href', '/lessons/session-2026-10-10-fork');
    expect(screen.getByRole('heading', { name: 'Forks' })).toBeInTheDocument();
    expect(document.querySelector('.rooky-focus-card .trend-worse')).toHaveTextContent('Slipping');
    expect(document.querySelector('.rooky-fresh')).toHaveTextContent('Since we started: 3 of 4 clean');
    expect(document.querySelector('.rooky-toward')).toHaveTextContent('4/6');
    expect(screen.getByRole('link', { name: 'vs Duke-BOT, move 14' })).toHaveAttribute('href', '/games/77/27');
    expect(screen.getByRole('link', { name: 'Open the lesson' })).toHaveAttribute('href', '/lessons/game-77');
    expect(screen.getByText('Lost')).toBeInTheDocument();
    // The briefing is said once a day.
    await waitFor(() => expect(JSON.parse(localStorage.getItem('chess-jd-rooky-heard') ?? '[]')).toEqual(['briefing:2026-10-10']));
  });

  test('Rooky watches the cursor and talks through what the AI coach wrote', async () => {
    const server = fakeServer();
    server.on('api/coach/home', () => HOME);
    server.on('api/coach', () => ({
      available: true, model: 'ollama/qwen3:8b', auto: true, models: ['ollama/qwen3:8b'], reason: null, fresh: true,
      generated_at: '2026-10-09T10:00:00+00:00', job: { running: false, error: null }, tasks: [],
      advice: { headline: 'Your openings leak points.', strengths: ['You convert won endgames.'],
        focus: [{ title: 'Forks', why: 'You miss them early.', drill: { kind: 'puzzles', target: 'fork' } }],
        weekly_plan: ['Mon: 20 fork puzzles'] },
    }));
    renderAt('/coach');
    await screen.findByText("Right now, we're working on forks.", { exact: false });
    expect(document.querySelector('.rooky-hero .cursor-rook')).not.toBeNull();
    const week = await screen.findByRole('button', { name: 'Plan my week' });
    fireEvent.click(week);
    expect(week).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.rooky-hero .rook-speaker-bubble')).toHaveTextContent('Mon: 20 fork puzzles');
    fireEvent.click(screen.getByRole('button', { name: 'What am I doing well?' }));
    expect(document.querySelector('.rooky-hero .rook-speaker-bubble')).toHaveTextContent('You convert won endgames.');
    fireEvent.click(screen.getByRole('button', { name: "Today's plan" }));
    expect(document.querySelector('.rooky-hero .rook-speaker-bubble')).toHaveTextContent("Right now, we're working on forks.");
    // The coach's notes sit beside the lessons, and its model in the header.
    expect(screen.getByRole('heading', { name: 'Rooky noticed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'qwen3:8b · on this computer' })).toBeInTheDocument();
  });

  test('skipping a focus asks the coach for a new plan', async () => {
    const server = fakeServer();
    server.on('api/coach/home', () => HOME);
    server.on('api/coach/focus', () => ({ ...HOME, focus: [] }));
    renderAt('/coach');
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull());
    expect(server.calls.find(c => c.path === 'api/coach/focus')?.body).toEqual({ action: 'skip', skill: 'fork' });
  });

  test('the practise button builds that skill\'s session', async () => {
    const server = fakeServer();
    server.on('api/coach/home', () => HOME);
    server.on('api/coach/session', body => ({ slug: `session-2026-10-10-${body?.skill}` }));
    server.on(/^api\/lessons/, () => ({ error: 'not needed' }));
    const { location } = renderAt('/coach');
    fireEvent.click(await screen.findByRole('button', { name: 'Practise this' }));
    await waitFor(() => expect(location().pathname).toBe('/lessons/session-2026-10-10-fork'));
  });

  test('a page opened without a click offers to hear Rooky instead of talking', async () => {
    const server = fakeServer();
    server.on('api/coach/home', () => HOME);
    Object.defineProperty(navigator, 'userActivation', { value: { hasBeenActive: false }, configurable: true });
    try {
      renderAt('/coach');
      expect(await screen.findByRole('button', { name: /Tap to hear Rooky/ })).toBeInTheDocument();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).userActivation;
    }
  });
});
