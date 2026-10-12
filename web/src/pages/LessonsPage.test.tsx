import { onTestFinished } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { boardAfter, fakeServer, renderAt, START, playMove } from '../test/harness';
import { setLessonSoundOn } from '../hooks/useNarration';
import { moveLabel, narrationBeats } from './LessonsPage';
import { enterStoryLesson, leaveStoryLesson } from '../lib/story';
import { makeDrill, reach, squareName } from '../lib/drills';
import type { Lesson, LessonCatalog } from '../types';

/** A stub WebAudio context that records every sound started: an oscillator's type, or 'noise' for a click. */
function fakeAudioContext() {
  const started: string[] = [];
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  vi.stubGlobal('AudioContext', class {
    state = 'running';
    currentTime = 0;
    destination = {};
    resume() { return Promise.resolve(); }
    createOscillator() {
      const osc = { type: 'sine', frequency: param(), start: vi.fn(), stop: vi.fn(), connect: (node: unknown) => node };
      osc.start = vi.fn(() => started.push(osc.type));
      return osc;
    }
    createGain() { return { gain: param(), connect: (node: unknown) => node }; }
    sampleRate = 8000;
    createBuffer(_channels: number, length: number) { return { sampleRate: 8000, getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { return { buffer: null, start: vi.fn(() => started.push('noise')), stop: vi.fn(), connect: (node: unknown) => node }; }
    createBiquadFilter() { return { type: 'bandpass', frequency: param(), Q: param(), connect: (node: unknown) => node }; }
  });
  return started;
}

/** The coach's mascot in the current step view. */
const coach = () => document.querySelector('.coach-row .mascot');

const card = (extra: Partial<LessonCatalog['lessons'][number]> = {}): LessonCatalog['lessons'][number] => ({
  slug: 'italian', title: 'Italian basics', summary: 'Develop and castle.', category: 'openings', level: 'beginner', minutes: 4,
  requires: [], unit: null, practice: null, steps: 2, step: 0, completed: null, ...extra,
});

const lesson = (extra: Partial<Lesson> = {}): Lesson => ({
  slug: 'italian', title: 'Italian basics', summary: 'Develop and castle.', category: 'openings', level: 'beginner', minutes: 4,
  requires: [], unit: null, practice: null, step: 0, completed: null, orientation: 'white',
  steps: [
    { id: 'develop', kind: 'play', title: 'Develop', orientation: 'white', marks: [], fen: START, prompt: 'Open with the king pawn, then the knight.',
      hint: 'Start with e4.', success: 'Nicely developed.', alternatives: [], mate: false,
      moves: [{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }, { uci: 'g1f3', san: 'Nf3' }] },
    { id: 'quiz', kind: 'choose', title: null, orientation: 'white', marks: [], fen: null, question: 'Where does the king go?',
      options: [{ text: 'Castled', correct: true, why: 'Safe behind its pawns.' }, { text: 'The center', correct: false, why: 'Too exposed.' }] },
  ],
  ...extra,
});

const move = (from: string, to: string) => playMove(new RegExp(`on ${from}$`), new RegExp(`${to}$`));

describe('Lessons', () => {
  test('the list groups lessons and shows progress and suggestions', async () => {
    fakeServer().on('api/lessons', () => ({
      lessons: [card({ completed: '2026-10-01T00:00:00Z', step: 2 }),
        card({ slug: 'lucena', title: 'Lucena', category: 'endgames', requires: ['opposition'], step: 1, steps: 4 }),
        card({ slug: 'opposition', title: 'Opposition', category: 'endgames' })],
      problems: ['broken: unknown kind "video".'],
    }));
    renderAt('/lessons');
    expect(await screen.findByRole('heading', { name: 'Openings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Endgames' })).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 completed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Lucena/ })).toHaveAttribute('href', '/lessons/lucena');
    expect(screen.getByText('Continue · step 2 of 4')).toBeInTheDocument();
    expect(screen.getByText('Best after: Opposition')).toBeInTheDocument();
    expect(screen.getByText('One lesson file could not be loaded')).toBeInTheDocument();
    // A plain catalog now: Story is the guided route, linked from the top.
    expect(screen.getByRole('link', { name: 'Follow the Story instead' })).toHaveAttribute('href', '/story');
    expect(screen.getByText('Completed ✓')).toBeInTheDocument();
    expect(screen.queryByText('START')).toBeNull();
  });

  test('opening a lesson shows the get-ready screen, whose start resumes with the coach on', async () => {
    fakeServer().on('api/lessons/italian', () => lesson({ step: 1 }));
    const { location } = renderAt('/lessons/italian');
    // The ready screen offers a sound check and resumes at the step reached.
    expect(await screen.findByRole('button', { name: 'Test sound' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue from step 2' }));
    await waitFor(() => expect(location().pathname).toBe('/lessons/italian/2'));
    expect(await screen.findByText('Where does the king go?')).toBeInTheDocument();
    // Starting switched the coach on: autoplay is running.
    expect(screen.getByRole('button', { name: 'Pause the lesson' })).toBeInTheDocument();
  });

  test('lessons with a video get a Videos shelf and a Watch button that plays it', async () => {
    const server = fakeServer();
    server.on('api/lessons', () => ({ lessons: [card({ video: { youtube: 'dQw4w9WgXcQ' } }), card({ slug: 'lucena', title: 'Lucena', category: 'endgames' })], problems: [] }));
    server.on('api/lessons/italian', () => lesson({ video: { youtube: 'dQw4w9WgXcQ' } }));
    renderAt('/lessons');
    const shelf = (await screen.findByRole('heading', { name: 'Videos' })).closest('section')!;
    expect(within(shelf).getByRole('link', { name: /Italian basics/ })).toHaveAttribute('href', '/lessons/italian');
    expect(within(shelf).queryByRole('link', { name: /Lucena/ })).toBeNull();

    renderAt('/lessons/italian');
    fireEvent.click(await screen.findByRole('button', { name: 'Watch the video' }));
    expect(screen.getByTitle('Italian basics, video')).toHaveAttribute('src', expect.stringContaining('youtube-nocookie.com/embed/dQw4w9WgXcQ'));
  });

  test('a lesson without a video has no Videos shelf or Watch button', async () => {
    const server = fakeServer();
    server.on('api/lessons', () => ({ lessons: [card()], problems: [] }));
    server.on('api/lessons/italian', () => lesson());
    renderAt('/lessons');
    expect(await screen.findByRole('heading', { name: 'Openings' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Videos' })).toBeNull();
    renderAt('/lessons/italian');
    expect(await screen.findByRole('button', { name: 'Test sound' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Watch the video' })).toBeNull();
  });

  test('a lesson opens full-window: its header names it and the exit goes back to the library', async () => {
    fakeServer().on('api/lessons/italian', () => lesson());
    renderAt('/lessons/italian/1');
    const header = (await screen.findByRole('link', { name: 'Leave the lesson' })).closest('header')!;
    expect(within(header).getByText('Italian basics')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Leave the lesson' })).toHaveAttribute('href', '/lessons');
    expect(within(header).getByText('1 / 2')).toBeInTheDocument();
  });

  test('starting without sound mutes the coach and leaves autoplay off', async () => {
    try {
      fakeServer().on('api/lessons/italian', () => lesson());
      const { location } = renderAt('/lessons/italian');
      fireEvent.click(await screen.findByRole('button', { name: 'Start without sound' }));
      await waitFor(() => expect(location().pathname).toBe('/lessons/italian/1'));
      expect(screen.getByRole('button', { name: 'Unmute the coach' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Play the lesson' })).toBeInTheDocument();
    } finally {
      setLessonSoundOn(true);
    }
  });

  test('a play step rejects a wrong move, plays the reply, and saves progress on continue', async () => {
    const server = fakeServer();
    server.on('api/lessons/italian', () => lesson());
    server.on('api/position', body => boardAfter(body?.moves as string[], (body?.moves as string[]).length % 2 ? ['e7e5'] : ['e2e4', 'd2d4', 'g1f3']));
    server.on('api/move', body => ({ ...boardAfter([...(body?.moves as string[]), String(body?.move)]), san: 'd4', uci: 'd2d4' }));
    server.on('api/lessons/progress', body => ({ step: body?.step, completed: null }));
    server.on('api/lessons/italian/steps/develop', () => ({ ok: true, xpGained: 10, xp: 10, level: 1 }));
    const { location } = renderAt('/lessons/italian/1');

    await move('d2', 'd4');
    expect(await screen.findByText(/is not the move here/)).toBeInTheDocument();
    // A miss never forces a hint: the reader climbs the ladder when they want, a rung at a time.
    expect(screen.queryByText('Start with e4.')).not.toBeInTheDocument();
    // The verdict locks the board until the reader acknowledges it.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show a hint' }));
    expect(screen.getByText(/Look at every check, capture and threat/)).toBeInTheDocument();
    expect(screen.queryByText('Start with e4.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show a hint' }));
    expect(screen.getByText('Start with e4.')).toBeInTheDocument();

    await move('e2', 'e4');
    expect(await screen.findByText('e5', { selector: '.lesson-line li' }, { timeout: 3000 })).toBeInTheDocument();
    // The line updates before the board loads the reply's position; wait for the board.
    await screen.findByRole('button', { name: 'Black pawn on e5' });
    await move('g1', 'f3');
    expect(await screen.findByText('Nicely developed.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await waitFor(() => expect(location().pathname).toBe('/lessons/italian/2'));
    expect(server.calls.find(c => c.path === 'api/lessons/progress')?.body).toEqual({ slug: 'italian', step: 1 });
    // Completing the step posts its result: one miss, two hint rungs, no reveal.
    expect(server.calls.find(c => c.path === 'api/lessons/italian/steps/develop')?.body)
      .toEqual({ firstTry: false, hintsUsed: 2, revealsUsed: 0, attempts: 2 });
  });

  test('a branch gives the opponent another reply, and a replay prefers the defence not seen yet', async () => {
    const server = fakeServer();
    const base = lesson();
    const develop = base.steps[0] as Extract<Lesson['steps'][number], { kind: 'play' }>;
    server.on('api/lessons/italian', () => ({ ...base, steps: [{ ...develop, branches: [{ alternatives: [], mate: false,
      success: 'Against the Sicilian, the knight still comes out.',
      moves: [{ uci: 'e2e4', san: 'e4' }, { uci: 'c7c5', san: 'c5' }, { uci: 'g1f3', san: 'Nf3' }] }] }, base.steps[1]] }));
    server.on('api/position', body => {
      const moves = body?.moves as string[];
      return boardAfter(moves, moves.length % 2 ? ['e7e5', 'c7c5'] : ['e2e4', 'd2d4', 'g1f3']);
    });
    server.on('api/lessons/italian/steps/develop', () => ({ ok: true, xpGained: 10, xp: 10, level: 1 }));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);  // first pick: the main line
    try {
      renderAt('/lessons/italian/1');
      await move('e2', 'e4');
      expect(await screen.findByText('e5', { selector: '.lesson-line li' }, { timeout: 3000 })).toBeInTheDocument();
      await screen.findByRole('button', { name: 'Black pawn on e5' });
      await move('g1', 'f3');
      expect(await screen.findByText('Nicely developed.')).toBeInTheDocument();
      // The other defence is still unseen: the replay offers it, and the opponent plays it.
      fireEvent.click(screen.getByRole('button', { name: 'Try the other defence' }));
      await move('e2', 'e4');
      expect(await screen.findByText('c5', { selector: '.lesson-line li' }, { timeout: 3000 })).toBeInTheDocument();
      await screen.findByRole('button', { name: 'Black pawn on c5' });
      await move('g1', 'f3');
      expect(await screen.findByText('Against the Sicilian, the knight still comes out.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Play it again' })).toBeInTheDocument();
    } finally {
      random.mockRestore();
    }
  });

  test('under autoplay, a solved step waits for the praise to be heard before moving on', async () => {
    // Speech that only ends when the test says so: the praise must not be cut off by a timer.
    const utterances: { text: string; onend: (() => void) | null }[] = [];
    vi.stubGlobal('Audio', class { onended = null; onerror = null; pause() {} play() { return Promise.reject(new Error('404')); } });
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      onend: (() => void) | null = null; onerror: (() => void) | null = null; rate = 1; pitch = 1; voice: unknown = null;
      constructor(public text: string) { /* noop */ }
    });
    vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel: () => {}, speak: (u: { text: string; onend: (() => void) | null }) => utterances.push(u) });
    try {
      const server = fakeServer();
      server.on('api/lessons/italian', () => lesson());
      server.on('api/position', body => boardAfter(body?.moves as string[], (body?.moves as string[]).length % 2 ? ['e7e5'] : ['e2e4', 'd2d4', 'g1f3']));
      server.on('api/move', body => ({ ...boardAfter([...(body?.moves as string[]), String(body?.move)]), san: 'e4', uci: 'e2e4' }));
      server.on('api/lessons/progress', body => ({ step: body?.step, completed: null }));
      server.on('api/lessons/italian/steps/develop', () => ({ ok: true, xpGained: 10, xp: 10, level: 1 }));
      const { location } = renderAt('/lessons/italian/1');
      fireEvent.click(await screen.findByRole('button', { name: 'Play the lesson' }));

      await move('e2', 'e4');
      await screen.findByRole('button', { name: 'Black pawn on e5' }, { timeout: 3000 });
      await move('g1', 'f3');
      await waitFor(() => expect(utterances.some(u => u.text === 'Nicely developed.')).toBe(true));
      // Well past the old fixed delay, the praise is still playing, so the step stays.
      await act(async () => { await new Promise(r => setTimeout(r, 1800)); });
      expect(location().pathname).toBe('/lessons/italian/1');
      // The praise ends: after a beat, the lesson moves on.
      await act(async () => { utterances.find(u => u.text === 'Nicely developed.')!.onend?.(); });
      await waitFor(() => expect(location().pathname).toBe('/lessons/italian/2'), { timeout: 4000 });
    } finally {
      vi.unstubAllGlobals();
    }
  }, 15000);

  test('another move: Stockfish accepts one as good as the listed one, and explains one that loses', async () => {
    const server = fakeServer();
    server.on('api/lessons/italian', () => lesson());
    server.on('api/position', body => boardAfter(body?.moves as string[], (body?.moves as string[]).length % 2 ? ['e7e5'] : ['e2e4', 'd2d4', 'g1f3']));
    server.on('api/move', body => ({ ...boardAfter([...(body?.moves as string[]), String(body?.move)]), san: 'd4', uci: String(body?.move) }));
    server.on('api/lessons/progress', body => ({ step: body?.step, completed: null }));
    server.on('api/lessons/italian/steps/develop', () => ({ ok: true, xpGained: 10, xp: 10, level: 1 }));
    // d4 on move one loses time here; d4 on the last move is as good as Nf3.
    server.on('api/judge', body => ((body?.moves as string[]).length === 0
      ? { verdict: 'worse', loss: 120, line: ['d4', 'exd4', 'Qxd4', 'Nc6'], uci: [] }
      : { verdict: 'good', loss: 10, line: ['d4'], uci: [] }));
    renderAt('/lessons/italian/1');

    await move('d2', 'd4');
    expect(await screen.findByText(/is not the move here/)).toBeInTheDocument();
    expect(screen.getByText(/Black answers/)).toHaveTextContent('Black answers exd4, and after Qxd4 comes Nc6.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await move('e2', 'e4');
    await screen.findByRole('button', { name: 'Black pawn on e5' }, { timeout: 3000 });
    await move('d2', 'd4');
    expect(await screen.findByText('Also a strong move!')).toBeInTheDocument();
    expect(screen.getByText(/Stockfish rates/)).toHaveTextContent('Stockfish rates d4 as good as Nf3, the move this lesson teaches.');
  }, 15000);

  test('sounds and poses follow the moves and verdicts, and muted means silent', async () => {
    const started = fakeAudioContext();
    const server = fakeServer();
    server.on('api/lessons/italian', () => lesson());
    server.on('api/position', body => boardAfter(body?.moves as string[], (body?.moves as string[]).length % 2 ? ['e7e5'] : ['e2e4', 'd2d4', 'g1f3']));
    server.on('api/move', body => ({ ...boardAfter([...(body?.moves as string[]), String(body?.move)]), san: 'd4', uci: 'd2d4' }));
    server.on('api/lessons/progress', body => ({ step: body?.step, completed: null }));
    server.on('api/lessons/italian/steps/develop', () => ({ ok: true, xpGained: 10, xp: 10, level: 1 }));
    renderAt('/lessons/italian/1');

    // Muted: a wrong move shows the verdict but stays silent.
    await act(async () => { setLessonSoundOn(false); });
    await move('d2', 'd4');
    expect(await screen.findByText(/is not the move here/)).toBeInTheDocument();
    expect(started).toEqual([]);
    expect(coach()).toHaveAttribute('src', 'art/mascot/confused.webp');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    // Sound on: the same miss buzzes (a low sawtooth).
    await act(async () => { setLessonSoundOn(true); });
    await move('d2', 'd4');
    await screen.findByText(/is not the move here/);
    expect(started).toContain('sawtooth');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    // Solving the line knocks for each move (a wooden click of noise) and chimes on the verdict (sine).
    await move('e2', 'e4');
    await screen.findByRole('button', { name: 'Black pawn on e5' });
    await move('g1', 'f3');
    expect(await screen.findByText('Nicely developed.')).toBeInTheDocument();
    expect(started).toContain('noise');
    expect(started).toContain('sine');
    expect(coach()).toHaveAttribute('src', 'art/mascot/excited.webp');
    // The committed verdict keeps its polite announcement, in the coach's bubble.
    expect(document.querySelector('.coach-bubble')).toHaveAttribute('role', 'status');
  });

  test('a choose step explains each answer and finishing shows the next lesson', async () => {
    const server = fakeServer();
    server.on('api/lessons/italian', () => lesson({ step: 1 }));
    server.on('api/lessons/progress', body => ({ step: body?.step }));
    server.on('api/lessons/italian/steps/quiz', () => ({ ok: true, xpGained: 10, xp: 20, level: 1 }));
    server.on('api/lessons', () => ({ lessons: [card(), card({ slug: 'pins', title: 'Pins', category: 'tactics' })], problems: [] }));
    const { location } = renderAt('/lessons/italian/2');
    // Pick, check, miss: the verdict explains and offers a retry.
    fireEvent.click(await screen.findByRole('button', { name: 'The center' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByText('Too exposed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Finish lesson/ })).toBeNull();
    // A wrong answer: the verdict is announced and the coach looks confused.
    expect(document.querySelector('.coach-bubble')).toHaveAttribute('role', 'status');
    expect(coach()).toHaveAttribute('src', 'art/mascot/confused.webp');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Castled' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    // A right answer cheers the coach up.
    expect(coach()).toHaveAttribute('src', 'art/mascot/excited.webp');
    fireEvent.click(screen.getByRole('button', { name: /Finish lesson/ }));
    await waitFor(() => expect(location().pathname).toBe('/lessons/italian/done'));
    // The completion moment: a confetti burst, and the celebrating coach until the stars arrive.
    expect(document.querySelector('.confetti')).toBeInTheDocument();
    expect(document.querySelectorAll('.confetti-piece').length).toBe(60);
    expect(document.querySelector('.done-stars .mascot')).toHaveAttribute('src', 'art/mascot/confetti.webp');
    expect(await screen.findByRole('link', { name: /Next: Pins/ })).toHaveAttribute('href', '/lessons/pins');
    expect(server.calls.find(c => c.path === 'api/lessons/progress')?.body).toEqual({ slug: 'italian', step: 2 });
    // Two committed checks, the first one wrong.
    expect(server.calls.find(c => c.path === 'api/lessons/italian/steps/quiz')?.body)
      .toEqual({ firstTry: false, hintsUsed: 0, revealsUsed: 0, attempts: 2 });
  });

  test('the finish screen counts the hints used and, inside Story, keeps "next" in the chapter', async () => {
    enterStoryLesson('italian');
    try {
      const server = fakeServer();
      const done = lesson({
        step: 2, completed: '2026-10-04', stars: 2,
        stepResults: {
          develop: { firstTry: true, hintsUsed: 2, revealsUsed: 1, attempts: 1, completedAt: '2026-10-04' },
          quiz: { firstTry: false, hintsUsed: 0, revealsUsed: 0, attempts: 2, completedAt: '2026-10-04' },
        },
      });
      server.on('api/lessons/italian', () => done);
      server.on('api/lessons', () => ({
        lessons: [card({ completed: '2026-10-04' }), card({ slug: 'pins', title: 'Pins', category: 'tactics' }),
          card({ slug: 'london', title: 'London System', category: 'openings' })],
        problems: [],
      }));
      renderAt('/lessons/italian/done');
      // Two hints and one shown answer across the scored steps.
      const hints = (await screen.findByText('Hints')).closest('.done-stat')!;
      await waitFor(() => expect(within(hints as HTMLElement).getByText('3')).toBeInTheDocument());
      expect(await screen.findByRole('img', { name: /2/ })).toBeInTheDocument();
      // Pins is next in the library, but Story stays in the openings chapter.
      expect(await screen.findByRole('link', { name: 'Next: London System' })).toHaveAttribute('href', '/story/lesson/london');
      expect(screen.getByRole('link', { name: 'Back to the map' })).toHaveAttribute('href', '/story');
      // Nothing left to play on the finish screen.
      expect(screen.queryByRole('button', { name: 'Play the lesson' })).toBeNull();
    } finally {
      leaveStoryLesson();
    }
  });

  test('a reel step plays the game like a video: transport, seek, captions', async () => {
    const server = fakeServer();
    server.on('api/lessons/italian', () => lesson({
      steps: [
        { id: 'film', kind: 'reel', title: 'The miniature', orientation: 'white', marks: [], fen: START,
          text: 'Watch this miniature.',
          moves: [{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }, { uci: 'g1f3', san: 'Nf3' }, { uci: 'b8c6', san: 'Nc6' }],
          notes: [{ ply: 1, text: 'The king pawn opens.' }, { ply: 3, text: 'The knight joins.' }] },
        lesson().steps[1],
      ],
    }));
    renderAt('/lessons/italian/1');
    const play = await screen.findByRole('button', { name: 'Play' });
    expect(screen.getByText('Watch this miniature.')).toBeInTheDocument();
    expect(screen.getByText('0 / 4')).toBeInTheDocument();

    vi.useFakeTimers();
    await act(async () => { fireEvent.click(play); });
    await act(async () => { vi.advanceTimersByTime(1200); }); // one ply per ~1.1s
    expect(screen.getByText('1 / 4')).toBeInTheDocument();
    expect(screen.getByText('The king pawn opens.')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(1200); }); // ply 2
    await act(async () => { vi.advanceTimersByTime(1200); }); // ply 3
    expect(screen.getByText('3 / 4')).toBeInTheDocument();
    expect(screen.getByText('The knight joins.')).toBeInTheDocument();

    // Pausing stops the playback; the seek bar and the move buttons jump around.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pause' })); });
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText('3 / 4')).toBeInTheDocument();
    await act(async () => { fireEvent.change(screen.getByRole('slider', { name: 'Seek through the game' }), { target: { value: '0' } }); });
    expect(screen.getByText('0 / 4')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next move' })); });
    expect(screen.getByText('1 / 4')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Nc6' })); });
    expect(screen.getByText('4 / 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next move' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Continue/ })).toBeInTheDocument();
  });

  test('a guess step rolls the game, stops for the key move, and scores the reader', async () => {
    const server = fakeServer();
    server.on('api/lessons/italian', () => lesson({
      steps: [
        { id: 'story', kind: 'guess', title: 'Guess the move', orientation: 'white', marks: [], fen: START, text: 'Watch the opening.',
          moves: [{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }, { uci: 'g1f3', san: 'Nf3' }, { uci: 'b8c6', san: 'Nc6' }],
          notes: [], guesses: [{ ply: 3, prompt: 'How does White develop?', hint: 'A knight.', why: 'Nf3 attacks e5.', also: [] }] },
        lesson().steps[1],
      ],
    }));
    server.on('api/move', body => ({ ...boardAfter([...(body?.moves as string[]), String(body?.move)]), san: 'd4', uci: 'd2d4' }));
    renderAt('/lessons/italian/1');
    expect(await screen.findByText('Watch the opening.')).toBeInTheDocument();

    // The game rolls on its own (a ply every ~1.1s) and stops before move 3.
    expect((await screen.findAllByText('How does White develop?', {}, { timeout: 4000 })).length).toBeGreaterThan(0);

    await move('d2', 'd4');
    expect(await screen.findByText(/was not the game move/)).toBeInTheDocument();
    expect(screen.getByText('A knight.')).toBeInTheDocument();
    await move('g1', 'f3');
    expect((await screen.findAllByText(/Nf3 attacks e5/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Keep watching' }));
    // A miss on the first try: the move counts as shown, not found.
    expect(await screen.findByRole('button', { name: /Continue/ }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('0 / 1')).toBeInTheDocument();
  });

  test('autoplay does not advance when the narration fails instantly, only after a reading of the line', async () => {
    // The browser failure mode from the bug report: the mp3 is missing and every
    // utterance errors immediately (Chrome's cancel-then-speak race).
    vi.stubGlobal('Audio', class {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause() { /* noop */ }
      play() { return Promise.reject(new Error('404')); }
    });
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      onend: (() => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      rate = 1; pitch = 1; voice: unknown = null;
      constructor(public text: string) { /* noop */ }
    });
    const say = vi.fn((utterance: { onerror: ((event: unknown) => void) | null }) => {
      setTimeout(() => utterance.onerror?.({ error: 'interrupted' }), 0);
    });
    vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel: vi.fn(), speak: say });

    const server = fakeServer();
    server.on('api/lessons/italian', () => lesson({
      steps: [
        { id: 'idea', kind: 'explain', title: 'The idea', orientation: 'white', marks: [], fen: START, text: 'Develop and castle.',
          demo: [], narration: 'Bring your pieces out quickly and castle early.' },
        lesson().steps[1],
      ],
    }));
    server.on('api/lessons/progress', body => ({ step: body?.step, completed: null }));
    const { location } = renderAt('/lessons/italian/1');
    const play = await screen.findByRole('button', { name: 'Play the lesson' });

    vi.useFakeTimers();
    await act(async () => { fireEvent.click(play); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(say).toHaveBeenCalled();
    expect(location().pathname).toBe('/lessons/italian/1'); // an instant failure is not "narration over"
    await act(async () => { vi.advanceTimersByTime(2000); }); // past the reading-time fallback (~2.5s)
    expect(location().pathname).toBe('/lessons/italian/1'); // still waiting out the beat
    await act(async () => { vi.advanceTimersByTime(2000); }); // the 0.9s beat, then the next step
    expect(location().pathname).toBe('/lessons/italian/2');
    expect(server.calls.find(c => c.path === 'api/lessons/progress')?.body).toEqual({ slug: 'italian', step: 1 });
  });

  test('under autoplay, cued narration and the demo take turns: words, then the move, then more words', async () => {
    const utterances: { text: string; onend: (() => void) | null }[] = [];
    vi.stubGlobal('Audio', class { onended = null; onerror = null; pause() {} play() { return Promise.reject(new Error('404')); } });
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      onend: (() => void) | null = null; onerror: (() => void) | null = null; rate = 1; pitch = 1; voice: unknown = null;
      constructor(public text: string) { /* noop */ }
    });
    vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel: () => {}, speak: (u: { text: string; onend: (() => void) | null }) => utterances.push(u) });
    const said = (text: string) => utterances.find(u => u.text === text);
    const played = () => document.querySelectorAll('.lesson-demo ol button.played').length;
    try {
      const server = fakeServer();
      server.on('api/lessons/italian', () => lesson({
        steps: [
          { id: 'idea', kind: 'explain', title: 'The idea', orientation: 'white', marks: [], fen: START, text: 'Open the centre.',
            demo: [{ uci: 'e2e4', san: 'e4' }, { uci: 'e7e5', san: 'e5' }],
            narration: 'White grabs the centre. [move] Black answers in kind. [move]' },
          lesson().steps[1],
        ],
      }));
      server.on('api/position', body => boardAfter(body?.moves as string[], []));
      server.on('api/lessons/progress', body => ({ step: body?.step, completed: null }));
      const { location } = renderAt('/lessons/italian/1');
      // The bubble reads the line without its cues.
      expect(await screen.findByText('White grabs the centre. Black answers in kind.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Play the lesson' }));

      // First the words; the board waits for them.
      await waitFor(() => expect(said('White grabs the centre.')).toBeDefined());
      expect(played()).toBe(0);
      await act(async () => { said('White grabs the centre.')!.onend?.(); });
      await waitFor(() => expect(played()).toBe(1), { timeout: 3000 });
      // The move holds, then the coach goes on, and only then does the reply play.
      await waitFor(() => expect(said('Black answers in kind.')).toBeDefined(), { timeout: 3000 });
      expect(played()).toBe(1);
      await act(async () => { said('Black answers in kind.')!.onend?.(); });
      await waitFor(() => expect(played()).toBe(2), { timeout: 3000 });
      // The final position holds before the lesson moves on.
      expect(location().pathname).toBe('/lessons/italian/1');
      await waitFor(() => expect(location().pathname).toBe('/lessons/italian/2'), { timeout: 8000 });
    } finally {
      vi.unstubAllGlobals();
    }
  }, 25000);

  test('narration splits into spoken pieces at its move cues', () => {
    expect(narrationBeats('One. [move] Two. [move]')).toEqual(['One.', 'Two.', '']);
    expect(narrationBeats('No cues here.')).toEqual(['No cues here.']);
  });

  test('move labels follow the position', () => {
    expect(moveLabel(START, 0, 'e4')).toBe('1. e4');
    expect(moveLabel(START, 1, 'e5')).toBe('e5');
    expect(moveLabel('8/8/8/8/8/8/8/8 b - - 0 12', 0, 'Kf7')).toBe('12... Kf7');
    expect(moveLabel('8/8/8/8/8/8/8/8 b - - 0 12', 1, 'Ke2')).toBe('13. Ke2');
  });
  test('a drill makes its own board: a wrong count is explained, the right one is scored', async () => {
    // A fixed random source fixes the layout, so the test knows the answer.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    onTestFinished(() => random.mockRestore());
    const recipe = { kind: 'count' as const, piece: 'R' as const, blockers: 1, enemies: 1 };
    const layout = makeDrill(recipe, Math.floor(0.25 * 2 ** 31));
    const server = fakeServer();
    server.on('api/lessons/italian', () => lesson({
      steps: [{ id: 'count', title: 'Count the squares', orientation: 'white', ...recipe }],
    }));
    server.on('api/lessons/italian/steps/count', () => ({ ok: true, xpGained: 10, xp: 10, level: 1 }));
    renderAt('/lessons/italian/1');
    expect(await screen.findByRole('button', { name: `White rook ${squareName(layout.from)}` })).toBeInTheDocument();
    expect(layout.answer).toBe(reach('R', layout.from, { own: new Set(layout.own), enemies: layout.enemies }).length);
    const wrong = layout.options!.find(n => n !== layout.answer)!;
    fireEvent.click(screen.getByRole('button', { name: String(wrong) }));
    expect(screen.getByText(wrong > layout.answer! ? /Too many/ : /Not enough/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: String(layout.answer) }));
    expect(await screen.findByText(new RegExp(`Right, ${layout.answer} squares`))).toBeInTheDocument();
    await waitFor(() => expect(server.calls.find(c => c.path === 'api/lessons/italian/steps/count')?.body)
      .toEqual({ firstTry: false, hintsUsed: 0, revealsUsed: 0, attempts: 2 }));
    expect(screen.getByRole('button', { name: /Finish lesson/ })).toBeEnabled();
  });
});
