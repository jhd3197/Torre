// The shell-less toast: it renders #toast only while the Layout's own is absent.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AppDataProvider, useAppData } from '../state/AppData';
import { fakeServer } from '../test/harness';
import { Toast } from './Toast';

function Trigger() {
  const { toast } = useAppData();
  return <button type="button" onClick={() => toast('Saved.')}>notify</button>;
}

describe('Toast', () => {
  test('renders the toast message when no shell #toast exists', async () => {
    fakeServer();
    render(<AppDataProvider><Trigger /><Toast /></AppDataProvider>);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'notify' }));
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  });

  test('yields to the shell’s #toast when one is already mounted', async () => {
    fakeServer();
    render(<AppDataProvider><div id="toast" /><Trigger /><Toast /></AppDataProvider>);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'notify' }));
    expect(document.querySelectorAll('#toast')).toHaveLength(1);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
