// The app data is split by how often it changes: a board, which needs only the stable toast(),
// must not re-render on every analysis poll (every 1.5 s while a job runs) or on every toast.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { ChessBoard } from '../components/ChessBoard';
import { usePlanning } from '../hooks/usePlanning';
import { boardAfter, fakeServer } from '../test/harness';
import { AppDataProvider, useAnalysis, useAppData, useToast, useToastMessage } from './AppData';
import { PromotionProvider } from './Promotion';

const board = boardAfter([]);

function Board() {
  const planning = usePlanning(board);
  return <ChessBoard board={board} flipped={false} planning={planning} movable="turn" />;
}

let analysisRenders = 0;
function AnalysisProbe() {
  const { analysis } = useAnalysis();
  analysisRenders += 1;
  return <p>done {analysis?.done ?? '-'}</p>;
}

function ToastButton() {
  const toast = useToast();
  return <button type="button" onClick={() => toast('Saved.')}>notify</button>;
}

function ToastText() {
  return <p role="status">{useToastMessage()}</p>;
}

function setup() {
  const server = fakeServer();
  let done = 0;
  server.on('api/analysis', () => ({
    running: true, total: 10, done: done++, failed: 0, current: null, error: null, remaining: 10 - done, outdated: 0, engine: true,
  }));
  let boardRenders = 0;
  render(
    <AppDataProvider>
      <PromotionProvider>
        <Profiler id="board" onRender={() => { boardRenders += 1; }}><Board /></Profiler>
        <AnalysisProbe />
        <ToastButton />
        <ToastText />
      </PromotionProvider>
    </AppDataProvider>,
  );
  return { boardRenders: () => boardRenders };
}

describe('AppData contexts', () => {
  beforeEach(() => {
    analysisRenders = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  test('the board does not re-render on analysis status polls', async () => {
    const { boardRenders } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const boardBefore = boardRenders();
    const analysisBefore = analysisRenders;

    for (let tick = 0; tick < 4; tick++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    }

    expect(analysisRenders).toBeGreaterThanOrEqual(analysisBefore + 4); // the polls did land
    expect(screen.getByText(/^done \d+$/).textContent).not.toBe('done 0');
    expect(boardRenders()).toBe(boardBefore);
  });

  test('the board does not re-render when a toast shows or hides', async () => {
    const { boardRenders } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const before = boardRenders();

    fireEvent.click(screen.getByRole('button', { name: 'notify' }));
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
    await act(async () => { await vi.advanceTimersByTimeAsync(3600); });
    expect(screen.getByRole('status')).toHaveTextContent('');

    expect(boardRenders()).toBe(before);
  });

  test('useAppData still merges every part', async () => {
    fakeServer();
    let seen: ReturnType<typeof useAppData> | null = null;
    function Probe() { seen = useAppData(); return null; }
    render(<AppDataProvider><Probe /></AppDataProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(seen).toMatchObject({ toast: expect.any(Function), toastMessage: null, games: [], startAnalysis: expect.any(Function) });
  });
});
