import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { aiView, fakeServer, renderAt } from '../../test/harness';
import type { AiView } from '../../lib/ai';

const open = async () => {
  renderAt('/settings/ai');
  return screen.findByRole('list', { name: "What Torre's AI runs on" });
};

test('says what the AI runs on, and lists every provider by kind with its state', async () => {
  const server = fakeServer();
  server.on('api/ai', () => aiView({ desk: { running: true, version: null } }));
  const runtime = await open();
  expect(within(runtime).getByText('Prompture 1.13.11')).toBeInTheDocument();
  expect(within(runtime).getByText('Prompture Desk is open')).toBeInTheDocument();
  expect(within(runtime).getByText('Ollama: not running')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Your subscriptions' })).toBeInTheDocument();
  const login = screen.getByRole('article', { name: 'Claude Code' });
  expect(within(login).getByText('Ready')).toBeInTheDocument();
  const ollama = screen.getByRole('article', { name: 'Ollama' });
  expect(within(ollama).getByText('Start Ollama to use its models.')).toBeInTheDocument();
  expect(within(ollama).getByRole('link', { name: 'Get Ollama' })).toHaveAttribute('href', 'https://ollama.com/download');
  const claude = screen.getByRole('article', { name: 'Anthropic Claude' });
  expect(within(claude).getByText(/Key saved \(…1234\)\. Every Prompture app/)).toBeInTheDocument();
  const openai = screen.getByRole('article', { name: 'OpenAI' });
  expect(within(openai).getByRole('link', { name: 'Get a OpenAI key' })).toHaveAttribute('href', 'https://platform.openai.com/api-keys');
  // No model yet anywhere: the default and both features say so.
  expect(screen.getAllByText('No model yet', { selector: 'strong' })).toHaveLength(3);
});

test('a key is checked and saved on its card, and a key from the environment is not Torre’s to change', async () => {
  const server = fakeServer();
  let saved = false;
  const view = (): AiView => {
    const base = aiView();
    return { ...base, check: saved ? 'valid' : null, providers: base.providers.map(p => p.id === 'openai' && saved
      ? { ...p, ready: true, detail: 'key_saved', key: { hint: '…4321', source: 'saved' } }
      : p.id === 'claude' ? { ...p, key: { hint: '…9999', source: 'environment' } } : p) };
  };
  server.on('api/ai', view);
  server.on('api/ai/key', body => {
    if ((body as { key: string }).key === 'bad') throw new Error('OpenAI did not accept that key. Check it and try again.');
    saved = !!(body as { key: string }).key;
    return view();
  });
  await open();
  const claude = screen.getByRole('article', { name: 'Anthropic Claude' });
  expect(within(claude).getByText(/Key found in this computer's environment \(…9999\)/)).toBeInTheDocument();
  expect(within(claude).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  const openai = screen.getByRole('article', { name: 'OpenAI' });
  fireEvent.change(within(openai).getByLabelText('API key for OpenAI'), { target: { value: 'bad' } });
  fireEvent.click(within(openai).getByRole('button', { name: 'Save key' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('OpenAI did not accept that key.');
  fireEvent.change(within(openai).getByLabelText('API key for OpenAI'), { target: { value: 'sk-good-4321' } });
  fireEvent.click(within(openai).getByRole('button', { name: 'Save key' }));
  expect(await within(openai).findByText(/Key saved \(…4321\)/)).toBeInTheDocument();
  expect(server.calls.filter(c => c.path === 'api/ai/key').map(c => c.body)).toEqual([
    { provider: 'openai', key: 'bad' }, { provider: 'openai', key: 'sk-good-4321' }]);
  fireEvent.click(within(openai).getByRole('button', { name: 'Remove' }));
  await waitFor(() => expect(server.calls.at(-1)?.body).toEqual({ provider: 'openai', key: '' }));
});

test('the default model is picked from what is ready, tested, and a feature can have its own', async () => {
  const server = fakeServer();
  let view = aiView();
  server.on('api/ai', () => view);
  server.on('api/ai/settings', body => {
    const changes = body as { model?: string | null; features?: Record<string, string | null> };
    const model = changes.model !== undefined ? changes.model : view.settings.model;
    const features = { ...view.settings.features, ...changes.features };
    const pick = (f: 'coach' | 'explain') => features[f] ? { model: features[f]!, source: 'feature' as const } : { model, source: model ? 'default' as const : null };
    view = aiView({ settings: { model, features, setup_seen: true }, model, source: model ? 'default' : null,
      features: { coach: pick('coach'), explain: pick('explain') },
      models: { 'claude/claude-fable-5-1': { id: 'claude/claude-fable-5-1', name: 'Claude Fable 5.1', provider: 'claude', released: '', efforts: ['high'], cost: null } } });
    return view;
  });
  server.on('api/ai/test', () => ({ ok: true, seconds: 1.4, reply: 'ready' }));
  await open();
  const rows = () => document.querySelectorAll('.ai-model-row');
  fireEvent.click(within(rows()[0] as HTMLElement).getByRole('button', { name: 'Change' }));
  const picker = screen.getByRole('group', { name: 'Choose a model: Default model' });
  // Only what is ready; the rest is one switch away.
  expect(within(picker).queryByRole('button', { name: /GPT-6 Luna/ })).not.toBeInTheDocument();
  fireEvent.click(within(picker).getByRole('checkbox', { name: 'Show 2 more providers to set up' }));
  expect(within(picker).getByText('Needs a key')).toBeInTheDocument();
  fireEvent.change(within(picker).getByRole('searchbox', { name: 'Search models' }), { target: { value: 'fable' } });
  fireEvent.click(within(picker).getByRole('button', { name: /^Claude Fable 5\.1/ }));
  expect(await within(rows()[0] as HTMLElement).findByText('Claude Fable 5.1', { selector: 'strong' })).toBeInTheDocument();
  // Both features follow the default.
  expect(within(rows()[1] as HTMLElement).getByText(/the default/)).toBeInTheDocument();
  expect(server.calls.find(c => c.path === 'api/ai/settings')?.body).toEqual({ model: 'claude/claude-fable-5-1' });
  fireEvent.click(within(rows()[0] as HTMLElement).getByRole('button', { name: 'Test' }));
  expect(await screen.findByText('It answered in 1.4 s: “ready”')).toBeInTheDocument();
  // Explanations get their own model, typed in; then back to the default.
  const explain = document.getElementById('setting-ai-feature-explain')!;
  fireEvent.click(within(explain).getByRole('button', { name: 'Change' }));
  fireEvent.change(within(explain).getByRole('textbox', { name: 'Any other model' }), { target: { value: 'ollama/qwen3:8b' } });
  fireEvent.click(within(explain).getByRole('button', { name: 'Use' }));
  await waitFor(() => expect(server.calls.at(-1)?.body).toEqual({ features: { explain: 'ollama/qwen3:8b' } }));
  fireEvent.click(await within(explain).findByRole('button', { name: 'Use the default' }));
  await waitFor(() => expect(server.calls.at(-1)?.body).toEqual({ features: { explain: null } }));
});

test('without Prompture the page offers to install it', async () => {
  const server = fakeServer();
  let running = false;
  server.on('api/ai', () => aiView({ prompture: { installed: false, version: null, install: { running, error: null, done: false } }, providers: [] }));
  server.on('api/ai/install', () => { running = true; return aiView({ prompture: { installed: false, version: null, install: { running: true, error: null, done: false } }, providers: [] }); });
  renderAt('/settings/ai');
  fireEvent.click(await screen.findByRole('button', { name: 'Install Prompture' }));
  expect(await screen.findByText('Installing Prompture… this takes a minute.')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Models' })).not.toBeInTheDocument();
});

test('usage lists what models cost across Prompture apps', async () => {
  const server = fakeServer();
  server.on('api/ai/usage', () => ({ usage: [{ model: 'claude/claude-fable-5-1', calls: 12, tokens: 34000, cost: 0.4321, last_used: '2026-10-13' }] }));
  await open();
  const table = await screen.findByRole('table');
  expect(within(table).getByRole('rowheader', { name: 'claude/claude-fable-5-1' })).toBeInTheDocument();
  expect(within(table).getByText('$0.432')).toBeInTheDocument();
});
