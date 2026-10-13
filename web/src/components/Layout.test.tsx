// The app shell: the slimmed rail, folding, and the workspace menu.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { fakeServer, renderAt } from '../test/harness';
import { SNOOZE_KEY, STARRED_KEY } from '../lib/githubStar';

const RAIL_KEY = 'chess-jd-rail-folded';

describe('Layout rail', () => {
  test('the rail lists the seven main destinations and nothing else', async () => {
    fakeServer();
    renderAt('/');
    await act(async () => {});
    const nav = screen.getByRole('navigation', { name: 'Studio sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map(link => link.textContent)).toEqual(['Home', 'Story', 'Play', 'Puzzles', 'Arena', 'Coach', 'Profile']);
    // Everything else keeps its route but is re-homed: Profile carries Games,
    // Insights, Awards, Settings, Lessons and Train; Explore stays contextual.
    for (const name of ['Games', 'Train', 'Lessons', 'Explore', 'Insights', 'Settings', 'Awards']) {
      expect(within(nav).queryByRole('link', { name })).toBeNull();
    }
  });

  test('Play points at the bot lobby, Arena at /arena and Profile at /profile', async () => {
    fakeServer();
    renderAt('/');
    await act(async () => {});
    const nav = screen.getByRole('navigation', { name: 'Studio sections' });
    expect(within(nav).getByRole('link', { name: 'Play' })).toHaveAttribute('href', '/play/bots');
    expect(within(nav).getByRole('link', { name: 'Arena' })).toHaveAttribute('href', '/arena');
    expect(within(nav).getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');
  });

  test('Play is the active item on both /play and /play/bots', async () => {
    fakeServer();
    renderAt('/play/bots');
    await act(async () => {});
    const nav = screen.getByRole('navigation', { name: 'Studio sections' });
    expect(within(nav).getByRole('link', { name: 'Play' })).toHaveClass('active');
  });

  test('the rail folds from its button and with [, remembering the choice', async () => {
    fakeServer();
    renderAt('/');
    await act(async () => {});
    const shell = document.querySelector('.shell')!;
    expect(shell).toHaveAttribute('data-rail', 'open');
    expect(localStorage.getItem(RAIL_KEY)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fold navigation' }));
    expect(shell).toHaveAttribute('data-rail', 'folded');
    expect(localStorage.getItem(RAIL_KEY)).toBe('1');
    // Folded, the logo button offers the way back.
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: '[' });
    expect(shell).toHaveAttribute('data-rail', 'open');
    expect(localStorage.getItem(RAIL_KEY)).toBe('0');
  });

  test('the [ shortcut is ignored while typing', async () => {
    fakeServer();
    renderAt('/');
    await act(async () => {});
    const shell = document.querySelector('.shell')!;
    const input = document.createElement('input');
    document.body.append(input);
    try {
      fireEvent.keyDown(input, { key: '[' });
      expect(shell).toHaveAttribute('data-rail', 'open');
    } finally {
      input.remove();
    }
  });

  test('a choice stored under the old key is kept', async () => {
    localStorage.setItem('studio.nav.collapsed', '1');
    fakeServer();
    renderAt('/');
    await act(async () => {});
    expect(document.querySelector('.shell')).toHaveAttribute('data-rail', 'folded');
    expect(localStorage.getItem(RAIL_KEY)).toBe('1');
    expect(localStorage.getItem('studio.nav.collapsed')).toBeNull();
  });

  test('a stored folded choice wins on the next visit', async () => {
    localStorage.setItem(RAIL_KEY, '1');
    fakeServer();
    renderAt('/');
    await act(async () => {});
    expect(document.querySelector('.shell')).toHaveAttribute('data-rail', 'folded');
  });
});

describe('Workspace menu', () => {
  test('behind the sign-in gateway it shows the account, Sign out and, for an admin, Admin', async () => {
    const server = fakeServer();
    server.on('auth/me', () => ({ name: 'Ana Pérez', email: 'ana@example.com', admin: true }));
    renderAt('/');
    await act(async () => {});
    const button = screen.getByRole('button', { name: 'Ana Pérez' });
    expect(button).toHaveTextContent('AP');
    fireEvent.click(button);
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toHaveAttribute('href', 'logout');
    expect(screen.getByRole('menuitem', { name: 'Admin' })).toHaveAttribute('href', 'admin');
  });

  test('on your own computer there is no Sign out', async () => {
    fakeServer();
    renderAt('/');
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Player' }));
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).toBeNull();
  });

  test('the user block opens a menu with Profile, Settings and import', async () => {
    fakeServer();
    renderAt('/');
    await act(async () => {});
    const button = screen.getByRole('button', { name: 'Player' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Workspace' });
    expect(within(menu).getByRole('menuitem', { name: 'Profile' })).toHaveAttribute('href', '/profile');
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    // The old secondary sections moved to the Profile page.
    for (const name of ['Insights', 'Awards']) {
      expect(within(menu).queryByRole('menuitem', { name })).toBeNull();
    }
    // Escape closes it.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('Import games in the menu opens the import page', async () => {
    fakeServer();
    const { location } = renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: 'Player' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Import games' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(location().pathname).toBe('/import');
  });

  test('the star beside the logo opens Torre on GitHub', async () => {
    fakeServer();
    renderAt('/');
    await act(async () => {});
    const star = screen.getByRole('link', { name: 'Star Torre on GitHub' });
    expect(star).toHaveAttribute('href', 'https://github.com/jhd3197/Torre');
    expect(star).toHaveAttribute('target', '_blank');
    // A newcomer is not asked yet.
    expect(screen.queryByRole('note')).toBeNull();
  });

  test('the star card, once due, goes away for good after a click through', async () => {
    localStorage.setItem(SNOOZE_KEY, '1');
    fakeServer();
    renderAt('/');
    await act(async () => {});
    const card = screen.getByRole('note');
    expect(within(card).getByText('Enjoying Torre?')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('link', { name: 'Star on GitHub' }));
    expect(screen.queryByRole('note')).toBeNull();
    expect(localStorage.getItem(STARRED_KEY)).toBe('1');
  });

  test('"Not now" puts the star card away', async () => {
    localStorage.setItem(SNOOZE_KEY, '1');
    fakeServer();
    renderAt('/');
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('note')).toBeNull();
    expect(Number(localStorage.getItem(SNOOZE_KEY))).toBeGreaterThan(Date.now());
  });
});
