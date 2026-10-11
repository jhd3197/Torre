// The story map: chapter banners, hard locks, node links; and the boss focus screen.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { fakeServer, renderAt, type FakeServer } from '../test/harness';
import { recordStars } from '../lib/stars';
import { STORY_CHAPTERS } from '../data/story';
import type { LessonCard } from '../types';

const card = (slug: string, category: LessonCard['category'], completed: string | null = null): LessonCard => ({
  slug, title: `Lesson ${slug}`, summary: '', category, level: 'beginner', minutes: 5,
  requires: [], unit: null, practice: null, steps: 3, step: 0, completed,
});

function lessonsServer(lessons: LessonCard[]): FakeServer {
  const server = fakeServer();
  server.on('api/lessons', () => ({ lessons, problems: [] }));
  return server;
}

describe('StoryPage', () => {
  test('renders every chapter banner in campaign order', async () => {
    lessonsServer([card('the-rook', 'basics'), card('back-rank', 'checkmates')]);
    renderAt('/story');
    await act(async () => {});
    const banners = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent);
    expect(banners).toEqual(STORY_CHAPTERS.map(chapter => chapter.title));
  });

  test('chapter 1 is open with a current node; chapter 2 stays locked until the boss falls', async () => {
    lessonsServer([card('the-rook', 'basics'), card('back-rank', 'checkmates')]);
    renderAt('/story');
    await act(async () => {});
    // The first lesson of chapter 1 is the current node, with a Start flag and a story link.
    const start = screen.getByText('Start');
    expect(start.closest('a')).toHaveAttribute('href', '/story/lesson/the-rook');
    // Chapter 2's section announces itself as locked; its nodes are not links.
    const locked = screen.getByLabelText('Chapter 2, locked');
    expect(within(locked).queryByRole('link')).toBeNull();
  });

  test('beating a chapter boss unlocks the next chapter', async () => {
    recordStars(STORY_CHAPTERS[0].bossBotId, 1);
    try {
      lessonsServer([card('the-rook', 'basics', '2026-01-01'), card('back-rank', 'checkmates')]);
      renderAt('/story');
      await act(async () => {});
      expect(screen.queryByLabelText('Chapter 2, locked')).toBeNull();
      const links = screen.getAllByRole('link').map(link => link.getAttribute('href'));
      // Chapter 1's gauntlet is now the current node there; chapter 2's first lesson opens.
      expect(links).toContain(`/story/gauntlet/${STORY_CHAPTERS[0].id}`);
      expect(links).toContain(`/story/lesson/back-rank`);
      // Chapter 2's own gauntlet and boss stay locked until its path reaches them.
      expect(links).not.toContain(`/story/gauntlet/${STORY_CHAPTERS[1].id}`);
      expect(links).not.toContain(`/story/boss/${STORY_CHAPTERS[1].id}`);
    } finally {
      localStorage.clear();
    }
  });

  test('the library link offers free browsing outside the path', async () => {
    lessonsServer([]);
    renderAt('/story');
    await act(async () => {});
    expect(screen.getByRole('link', { name: /lesson library/i })).toHaveAttribute('href', '/lessons');
  });

  test('shows today’s goal ring from the profile streak, quiet until done', async () => {
    const server = lessonsServer([]);
    server.on('api/profile', () => ({
      xp: 40, level: 1, xpIntoLevel: 40, xpForLevel: 100,
      streak: { count: 2, doneToday: false, goal: 30, xpToday: 18 },
    }));
    renderAt('/story');
    await act(async () => {});
    expect(screen.getByRole('img', { name: 'Today’s goal: 18 of 30 XP' })).toBeInTheDocument();
    const goal = screen.getByText('Today’s goal 18/30 XP').closest('.daily-goal');
    expect(goal).not.toHaveClass('done');
  });

  test('the goal ring celebrates a done day', async () => {
    const server = lessonsServer([]);
    server.on('api/profile', () => ({
      xp: 40, level: 1, xpIntoLevel: 40, xpForLevel: 100,
      streak: { count: 3, doneToday: true, goal: 30, xpToday: 30 },
    }));
    renderAt('/story');
    await act(async () => {});
    expect(screen.getByText('Today’s goal 30/30 XP').closest('.daily-goal')).toHaveClass('done');
  });
});

describe('the placement offer', () => {
  const ratedServer = (rating: number) => {
    const server = lessonsServer([card('the-rook', 'basics'), card('back-rank', 'checkmates')]);
    server.on('api/puzzles', () => ({ rating, rated: 25 }));
    return server;
  };

  test('a rated player with chapter 2 locked gets the one-time skip-ahead modal', async () => {
    ratedServer(1500);
    renderAt('/story');
    await act(async () => {});
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('You already solve tactics like a 1500 player');
    expect(within(dialog).getByRole('button', { name: 'Unlock up to Chapter 4' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Start from the beginning' })).toBeInTheDocument();
  });

  test('accepting unlocks through the offered chapter and records the placement', async () => {
    try {
      ratedServer(1250);
      renderAt('/story');
      await act(async () => {});
      fireEvent.click(await screen.findByRole('button', { name: 'Unlock up to Chapter 2' }));
      await act(async () => {});
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(JSON.parse(localStorage.getItem('story-placement')!)).toEqual({ unlockedThrough: 2 });
      expect(screen.queryByLabelText('Chapter 2, locked')).toBeNull();
      expect(screen.getByLabelText('Chapter 3, locked')).toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  test('declining records the decline and never asks again', async () => {
    try {
      ratedServer(1800);
      renderAt('/story');
      await act(async () => {});
      fireEvent.click(await screen.findByRole('button', { name: 'Start from the beginning' }));
      await act(async () => {});
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(JSON.parse(localStorage.getItem('story-placement')!)).toEqual({ declined: true });
      expect(screen.getByLabelText('Chapter 2, locked')).toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  test('a fresh install at the default rating gets no offer: it has not solved any rated puzzles', async () => {
    const server = lessonsServer([card('the-rook', 'basics'), card('back-rank', 'checkmates')]);
    server.on('api/puzzles', () => ({ rating: 1500, rated: 0 }));
    renderAt('/story');
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('no modal below 1200, once answered, or when chapter 2 is already open', async () => {
    ratedServer(1100);
    renderAt('/story');
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('no modal when the offer was already answered', async () => {
    try {
      localStorage.setItem('story-placement', JSON.stringify({ declined: true }));
      ratedServer(1800);
      renderAt('/story');
      await act(async () => {});
      await act(async () => {});
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      localStorage.clear();
    }
  });

  test('no modal when chapter 2 is already open', async () => {
    recordStars(STORY_CHAPTERS[0].bossBotId, 1);
    try {
      ratedServer(1800);
      renderAt('/story');
      await act(async () => {});
      await act(async () => {});
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      localStorage.clear();
    }
  });
});

describe('Story focus mode', () => {
  test('the boss page renders shell-less with an exit X that asks before leaving', async () => {
    fakeServer();
    const view = renderAt(`/story/boss/${STORY_CHAPTERS[0].id}`);
    await act(async () => {});
    // No nav rail, and the boss intro is up.
    expect(document.querySelector('.rail-shell')).toBeNull();
    const boss = STORY_CHAPTERS[0].bossBotId;
    expect(screen.getByRole('button', { name: 'Start the fight' })).toBeInTheDocument();
    expect(boss).toBeTruthy();
    // The X opens the exit modal instead of leaving.
    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Wait, don’t go!');
    fireEvent.click(screen.getByRole('button', { name: 'Keep learning' }));
    // Leaving returns to the story map.
    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    await act(async () => {});
    expect(view.location().pathname).toBe('/story');
  });

  test('a beaten boss shows the earned stars and offers to fight again', async () => {
    recordStars(STORY_CHAPTERS[0].bossBotId, 2);
    try {
      fakeServer();
      renderAt(`/story/boss/${STORY_CHAPTERS[0].id}`);
      await act(async () => {});
      expect(screen.getByRole('button', { name: 'Fight again' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Start the fight' })).toBeNull();
      expect(screen.getByText(/already fallen/)).toBeInTheDocument();
    } finally {
      localStorage.clear();
    }
  });

  test('an unknown chapter redirects back to the map', async () => {
    fakeServer().on('api/lessons', () => ({ lessons: [], problems: [] }));
    const view = renderAt('/story/boss/no-such-chapter');
    await act(async () => {});
    expect(view.location().pathname).toBe('/story');
  });
});
