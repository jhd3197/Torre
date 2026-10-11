// The app on a phone: a tab bar instead of the drawer, and Home, the bot lobby, Play and the review laid out for it.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeServer, renderAt, START } from '../test/harness';
import type { GameDetail } from '../types';

/** A phone: every width query matches, motion preferences don't. */
function phone() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width'), media: query,
    addEventListener: () => {}, removeEventListener: () => {},
  }));
}

const GAME = { id: 301, opponent: 'Duke-BOT', date: '2026.09.05', user_result: 1, user_color: 'white', plies: 4 };

function serveGame(server: ReturnType<typeof fakeServer>) {
  server.on('api/games', () => ({ games: [GAME], engine: true }));
  server.on('api/games/301', (): GameDetail => ({
    initialFen: START, moves: [{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }, { uci: 'g1f3', san: 'Nf3' }, { uci: 'b8c6', san: 'Nc6' }],
    headers: { White: 'jhd3197', Black: 'Duke-BOT', Result: '1-0', Date: '2026.09.05' },
    record: { id: 301, user_color: 'white', opponent: 'Duke-BOT' },
  }));
}

test('on a phone the rail becomes a tab bar with the four main places', async () => {
  phone();
  fakeServer();
  renderAt('/');
  await act(async () => {});
  expect(document.querySelector('.shell')).toHaveAttribute('data-rail', 'tabs');
  const tabs = screen.getByRole('navigation', { name: 'Studio sections' });
  expect(within(tabs).getAllByRole('link').map(link => link.textContent)).toEqual(['Home', 'Play', 'Puzzles', 'Profile']);
  expect(within(tabs).getByRole('link', { name: 'Play' })).toHaveAttribute('href', '/play/bots');
  expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull();
});

test('Home on a phone has settings at the top and your last games, each opening its review', async () => {
  phone();
  serveGame(fakeServer());
  renderAt('/');
  expect(await screen.findByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  const recent = await screen.findByRole('region', { name: 'Recent games' });
  expect(within(recent).getByRole('link', { name: /vs Duke-BOT/ })).toHaveAttribute('href', '/games/301');
  expect(within(recent).getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/games');
});

test('the phone lobby opens a bot in a sheet, and Start begins the game', async () => {
  phone();
  fakeServer();
  const { location } = renderAt('/play/bots');
  expect(await screen.findByRole('heading', { name: 'Pick a bot' })).toBeInTheDocument();
  const first = document.querySelector<HTMLButtonElement>('.phone-bot-grid button')!;
  fireEvent.click(first);
  const sheet = await screen.findByRole('dialog');
  fireEvent.click(within(sheet).getByRole('button', { name: 'Start game' }));
  await waitFor(() => expect(location().pathname).toBe('/play'));
  // Before your first move the game can still be left without counting.
  expect(await screen.findByRole('button', { name: /Leave game/ })).toBeInTheDocument();
  expect(screen.getByText('Moves appear here. Tap one to look back.')).toBeInTheDocument();
});

test('a review on a phone gives the tab bar\'s room to its own controls', async () => {
  phone();
  serveGame(fakeServer());
  const { location } = renderAt('/games/301');
  expect(await screen.findByRole('link', { name: 'Back' })).toHaveAttribute('href', '/games');
  expect(screen.queryByRole('navigation', { name: 'Studio sections' })).toBeNull();
  // The opening review runs first; the tabs come once it is done.
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Reviewing your game' })).toBeNull());
  fireEvent.click(await screen.findByRole('button', { name: 'Moves' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Next move' }));
  await waitFor(() => expect(location().pathname).toBe('/games/301/1'));
  expect(screen.getByRole('button', { name: /^Go to move 1, e4/ })).toHaveAttribute('aria-current', 'step');
});
