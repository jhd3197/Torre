import { fireEvent, screen, waitFor } from '@testing-library/react';
import { fakeServer, renderAt } from '../test/harness';

describe('Coach hub', () => {
  test('provides working learning centers and switches tabs', async () => {
    fakeServer();
    const { location } = renderAt('/coach/learn');
    expect(await screen.findByRole('button', { name: 'Learning centers' })).toHaveAttribute('aria-pressed', 'true');
    const centers = document.querySelectorAll('.coach-center');
    expect(Array.from(centers, link => link.getAttribute('href'))).toEqual([
      '/lessons', '/puzzles', '/train', '/openings', '/endgames', '/story',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Stats' }));
    await waitFor(() => expect(location().pathname).toBe('/coach/progress'));
    fireEvent.click(screen.getByRole('button', { name: 'Your plan' }));
    await waitFor(() => expect(location().pathname).toBe('/coach'));
  });

  test('keeps stats sections inside the Coach hub', async () => {
    fakeServer();
    renderAt('/coach/progress/openings');
    expect(await screen.findByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/coach/progress');
    expect(screen.getByRole('link', { name: 'Openings' })).toHaveAttribute('href', '/coach/progress/openings');
    expect(screen.getByRole('button', { name: 'Stats' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('the plan shows your level and how far into it you are', async () => {
    const server = fakeServer();
    server.on('api/profile', () => ({ xp: 140, level: 3, xpIntoLevel: 12, xpForLevel: 30,
      streak: { days: 0, today: false, xpToday: 0, goal: 30, best: 0 } }));
    renderAt('/coach');
    expect(await screen.findByRole('link', { name: 'Level 3: 12 of 30 XP to the next level' })).toHaveAttribute('href', '/profile');
    expect(screen.getByText('12/30 XP')).toBeInTheDocument();
  });
});
