// Paste one chess.com or Lichess game link: the server fetches the game, saves it to the library and
// the review opens. When neither player is a name you play under, it asks which one you were.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useGameData } from '../state/AppData';

type LinkReply = { id: string; added: boolean } | { choose: string[] };

export function GameLinkForm() {
  const { t } = useTranslation('import');
  const navigate = useNavigate();
  const { reloadGames } = useGameData();
  const [url, setUrl] = useState('');
  const [choose, setChoose] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function open(me?: string) {
    setBusy(true);
    setError('');
    try {
      const reply = await api<LinkReply>('api/import/link', { url: url.trim(), ...(me ? { me } : {}) });
      if ('choose' in reply) {
        setChoose(reply.choose);
      } else {
        await reloadGames();
        navigate(`/games/${encodeURIComponent(reply.id)}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    setChoose(null);
    void open();
  }

  return (
    <form className="import-form game-link" onSubmit={submit}>
      <label className="import-field">
        <span>{t('link.title')}</span>
        <input type="url" required value={url} onChange={e => { setUrl(e.target.value); setChoose(null); }}
          placeholder={t('link.placeholder')} autoComplete="off" spellCheck={false} />
      </label>
      {choose ? (
        <div className="import-players" role="group" aria-label={t('link.choose')}>
          <p className="import-hint">{t('link.choose')}</p>
          {choose.map(name => (
            <button key={name} type="button" disabled={busy} onClick={() => void open(name)}><strong>{name}</strong></button>
          ))}
        </div>
      ) : (
        <button className="button primary" type="submit" disabled={busy || !url.trim()}>{busy ? t('link.busy') : t('link.open')}</button>
      )}
      {error && <p className="import-error" role="alert">{error}</p>}
    </form>
  );
}
