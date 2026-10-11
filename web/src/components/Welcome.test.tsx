import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeServer } from '../test/harness';
import { FirstRun } from './Welcome';

const pack = { id: 'voice-es', lang: 'es', title: 'Voz del entrenador en español', bytes: 31_000_000, lines: 1600, version: '1', installed: false, current: false };
const idle = { running: false, id: null, done: 0, total: 0, error: null };

test('a fresh install welcomes the reader: language, the voice pack with its size, then start', async () => {
  const server = fakeServer();
  server.on('api/setup', body => (body ? { onboarded: true } : { onboarded: false }));
  server.on('api/packs', () => ({ packs: [{ ...pack, id: 'voice-en', lang: 'en', title: 'Coach voice in English' }, pack], job: idle }));
  server.on('api/packs/install', () => ({ packs: [pack], job: { ...idle, running: true, id: 'voice-es', total: 31_000_000 } }));
  render(<FirstRun />);
  expect(await screen.findByRole('dialog', { name: 'Welcome to Torre' })).toBeInTheDocument();
  // Choosing Español switches the screen and shows only the Spanish pack.
  fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
  expect(await screen.findByText('Voz del entrenador en español')).toBeInTheDocument();
  expect(screen.queryByText('Coach voice in English')).toBeNull();
  expect(screen.getByText(/31 MB/)).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Descargar|Download/ })); });
  expect(server.calls.find(c => c.path === 'api/packs/install')?.body).toEqual({ id: 'voice-es' });
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
  // Skipping still finishes the setup.
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /browser|navegador/i })); });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(server.calls.some(c => c.path === 'api/setup' && (c.body as { onboarded?: boolean })?.onboarded)).toBe(true);
});

test('an install that was already set up shows nothing', async () => {
  fakeServer().on('api/setup', () => ({ onboarded: true }));
  render(<FirstRun />);
  await act(async () => {});
  expect(screen.queryByRole('dialog')).toBeNull();
});
