// Streak UI in focus mode: the flame chip in the header and the
// streak-at-risk line in the exit modal.
import { act, fireEvent, screen } from '@testing-library/react';
import { fakeServer, renderAt } from '../../test/harness';
import { STORY_CHAPTERS } from '../../data/story';
import type { Profile, Streak } from '../../types';

const profile = (streak: Streak): Profile => ({ xp: 120, level: 3, xpIntoLevel: 20, xpForLevel: 100, streak });

function renderBoss(p: Profile) {
  fakeServer().on('api/profile', () => p);
  renderAt(`/story/boss/${STORY_CHAPTERS[0].id}`);
  return act(async () => {});
}

describe('FocusMode streak chip', () => {
  test('shows the count next to an unlit flame until today’s goal is met', async () => {
    await renderBoss(profile({ count: 5, doneToday: false, goal: 30, xpToday: 12 }));
    const chip = screen.getByTitle('5 day streak · 12/30 XP today');
    expect(chip).toHaveTextContent('5');
    expect(chip).not.toHaveClass('lit');
  });

  test('lights the flame once today’s goal is done', async () => {
    await renderBoss(profile({ count: 5, doneToday: true, goal: 30, xpToday: 34 }));
    expect(screen.getByTitle('5 day streak · 34/30 XP today')).toHaveClass('lit');
  });

  test('stays hidden while there is no profile', async () => {
    fakeServer().on('api/profile', () => { throw new Error('offline'); });
    renderAt(`/story/boss/${STORY_CHAPTERS[0].id}`);
    await act(async () => {});
    expect(document.querySelector('.streak-chip')).toBeNull();
  });
});

describe('ExitModal streak-at-risk', () => {
  test('warns when the day’s streak is still on the line', async () => {
    await renderBoss(profile({ count: 5, doneToday: false, goal: 30, xpToday: 12 }));
    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Your 5-day streak is still on the line today.');
    expect(screen.getByRole('button', { name: 'Keep learning' })).toHaveClass('primary');
  });

  test('no warning once today’s goal is met, or without a streak', async () => {
    await renderBoss(profile({ count: 5, doneToday: true, goal: 30, xpToday: 34 }));
    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    expect(await screen.findByRole('dialog')).not.toHaveTextContent('streak is still on the line');
  });
});
