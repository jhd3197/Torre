import { api } from './api';
import type { PlaySave } from './storage';

export async function exportPlay(game: PlaySave, playerName: string, botName: string) {
  const { filename, report } = await api<{ filename: string; report: unknown }>('api/export', {
    initialFen: game.initialFen, moves: game.moves.map(move => move.uci),
    timings: game.timings ?? [], playerColor: game.playerColor,
    headers: {
      White: game.playerColor === 'white' ? playerName : botName,
      Black: game.playerColor === 'black' ? playerName : botName,
      Result: game.result ?? '*', TimeControl: '-',
      ...(game.resigned ? { Termination: 'resignation' } : {}),
    },
  });
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  const revoke = URL.revokeObjectURL.bind(URL);
  setTimeout(() => revoke(url), 1000);
}
