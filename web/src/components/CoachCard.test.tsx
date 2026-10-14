import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { aiView, fakeServer } from '../test/harness';
import { CoachCard, ModelMenu, drillPath, useCoach, type CoachData } from './CoachCard';

const coach = (extra: Partial<CoachData> = {}): CoachData => ({
  available: true, model: 'ollama/qwen3:8b', reason: null, fresh: true, generated_at: '2026-10-06T10:00:00+00:00',
  job: { running: false, error: null },
  advice: {
    headline: 'Your openings leak points.',
    strengths: ['You convert won endgames.'],
    focus: [
      { title: 'Forks', why: 'You miss forks at moves 6-10.', drill: { kind: 'puzzles', target: 'fork' } },
      { title: 'Back rank', why: 'Two losses to back-rank mates.', drill: { kind: 'lessons', target: 'back-rank-mate' } },
      { title: 'Tilt', why: 'You score less after a loss.', drill: { kind: 'play', target: '' } },
    ],
    weekly_plan: ['Mon: 20 fork puzzles', 'Tue: one rapid game'],
  },
  ...extra,
});

function Coach() {
  const state = useCoach();
  return <><ModelMenu state={state} /><CoachCard state={state} /></>;
}

const show = () => render(<MemoryRouter><Coach /></MemoryRouter>);

describe('CoachCard', () => {
  test('shows the headline, focus areas linked to their drill as actionable cards', async () => {
    fakeServer().on('api/coach', () => coach());
    show();
    expect(await screen.findByText('Your openings leak points.')).toBeInTheDocument();
    expect(screen.getByText('You convert won endgames.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Practice puzzles →' })).toHaveAttribute('href', '/puzzles/fork');
    expect(screen.getByRole('link', { name: 'Open the lesson →' })).toHaveAttribute('href', '/lessons/back-rank-mate');
    expect(screen.getByRole('link', { name: 'Play a game →' })).toHaveAttribute('href', '/play/bots');
    // The week's plan is Rooky's to say (CoachHome), not this card's.
    expect(screen.queryByText('Tue: one rapid game')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'qwen3:8b · on this computer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update plan' })).toBeDisabled();
    expect(screen.queryByText(/Your games changed/)).not.toBeInTheDocument();
  });

  test('regenerates on demand and shows the coach thinking', async () => {
    const server = fakeServer();
    server.on('api/coach', body => body ? coach({ job: { running: true, error: null } }) : coach({ fresh: false }));
    show();
    expect(await screen.findByText(/New activity is available/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Update plan' }));
    expect(await screen.findByText('Your coach is reading your games…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update plan' })).toBeDisabled();
    expect(server.calls.filter(c => c.path === 'api/coach' && c.body).length).toBe(1);
  });

  test('without a model the AI setup opens once on its own, and a model from what is ready is one click', async () => {
    const server = fakeServer();
    let model: string | null = null;
    server.on('api/coach', () => model ? coach({ model, source: 'default' }) : coach({ available: false, model: null, reason: 'no_model', advice: null, setup_seen: false }));
    server.on('api/ai/seen', () => ({}));
    server.on('api/ai/settings', body => {
      model = (body as { model: string }).model;
      return aiView({ settings: { model, features: {}, setup_seen: true }, model, source: 'default',
        models: { [model]: { id: model, name: 'Claude Code · Opus', provider: 'claude-code', released: '', efforts: [], cost: null } } });
    });
    show();
    expect(await screen.findByText('The coach needs an AI model to write its advice.')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Set up AI' })).toBeInTheDocument();
    await waitFor(() => expect(server.calls.some(c => c.path === 'api/ai/seen')).toBe(true));
    // Only what is ready is offered at first: the Claude Code login and the Claude key, not OpenAI.
    expect(await screen.findByRole('button', { name: /Claude Code · Opus/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Claude Fable 5.1, Thinks, $10 / $50 per M tokens' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /GPT-6 Luna/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Claude Code · Opus/ }));
    expect(await screen.findByText('Done: Torre now uses Claude Code · Opus.')).toBeInTheDocument();
    expect(server.calls.find(c => c.path === 'api/ai/settings')?.body).toEqual({ model: 'claude-code/opus' });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    // With a model chosen, the header chip names it.
    expect(await screen.findByRole('button', { name: 'opus' })).toBeInTheDocument();
  });

  test('once seen, the setup waits for its button', async () => {
    const server = fakeServer();
    server.on('api/coach', () => coach({ available: false, model: null, reason: 'no_model', advice: null, setup_seen: true }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Set up the AI coach' }));
    expect(await screen.findByRole('heading', { name: 'Set up AI' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'More in Settings > AI' })).toHaveAttribute('href', '/settings/ai');
    expect(server.calls.some(c => c.path === 'api/ai/seen')).toBe(false);
  });

  test('the model chip says a local model was picked and switches the coach to another', async () => {
    const server = fakeServer();
    let model = 'ollama/qwen3:8b';
    server.on('api/coach', () => coach({ model, source: model === 'ollama/qwen3:8b' ? 'auto' : 'feature' }));
    const local = ['qwen3:8b', 'mistral:latest'].map(name => ({ id: `ollama/${name}`, name, provider: 'ollama', released: '', efforts: [], cost: null }));
    server.on('api/ai', () => aiView({ providers: [{ id: 'ollama', name: 'Ollama', kind: 'local', ready: true, detail: 'running', url: null, key: null, models: local }] }));
    server.on('api/ai/settings', body => { model = (body as { features: { coach: string } }).features.coach; return aiView(); });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'qwen3:8b · on this computer' }));
    expect(screen.getByText(/Model: qwen3:8b \(found on this computer\)/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'qwen3:8b, Free' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: 'AI settings →' })).toHaveAttribute('href', '/settings/ai');
    fireEvent.click(screen.getByRole('button', { name: 'mistral:latest, Free' }));
    expect(await screen.findByRole('button', { name: 'mistral:latest · on this computer' })).toHaveAttribute('aria-expanded', 'false');
    expect(server.calls.find(c => c.path === 'api/ai/settings')?.body).toEqual({ features: { coach: 'ollama/mistral:latest' } });
  });

  test('installs Prompture from the card and surfaces model errors', async () => {
    const server = fakeServer();
    let installing = false;
    server.on('api/coach', () => coach({ available: false, reason: 'prompture_missing', advice: null,
      install: { running: installing, error: null, done: false } }));
    server.on('api/ai/install', () => { installing = true; return aiView(); });
    const view = show();
    expect(await screen.findByText(/needs Prompture/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Install the AI coach' }));
    expect(await screen.findByText(/Installing Prompture/)).toBeInTheDocument();
    view.unmount();
    server.on('api/coach', () => coach({ advice: null, fresh: false, job: { running: false, error: 'connection refused' } }));
    show();
    expect(await screen.findByText('The coach could not answer: connection refused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask the coach' })).toBeEnabled();
  });

  test('offers retry when the saved plan cannot load', async () => {
    const server = fakeServer();
    show();
    await waitFor(() => expect(server.calls.some(c => c.path === 'api/coach')).toBe(true));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your plan could not load.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  test('drill links', () => {
    expect(drillPath({ kind: 'puzzles', target: '' })).toBe('/puzzles');
    expect(drillPath({ kind: 'lessons', target: '' })).toBe('/lessons');
    expect(drillPath({ kind: 'openings', target: 'C30' })).toBe('/openings');
  });

  test('shows saved task progress and real destinations without regenerating on visits', async () => {
    const server = fakeServer();
    server.on('api/coach', () => coach({ tasks: [
      { id: 'forks', kind: 'puzzles', target: 'fork', title: 'Forks', why: 'Practice double attacks.', goal: 5, progress: 2, done: false },
      { id: 'lesson', kind: 'lessons', target: 'back-rank-mate', title: 'Back rank', why: '', goal: 1, progress: 1, done: true },
    ] }));
    const first = show();
    expect(await screen.findByText('2 / 5 completed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Practice puzzles →' })).toHaveAttribute('href', '/puzzles/fork');
    expect(screen.getByRole('link', { name: 'Practice again →' })).toHaveAttribute('href', '/lessons/back-rank-mate');
    first.unmount();
    show();
    expect(await screen.findByText('2 / 5 completed')).toBeInTheDocument();
    expect(server.calls.filter(c => c.path === 'api/coach' && c.body)).toHaveLength(0);
  });
});
