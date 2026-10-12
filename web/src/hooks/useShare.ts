// Sharing for a page: a torre.sh link when hosted, the page's own fallback (copying the PGN) when
// not. Call it once per page and hand the result to each ShareButton, so the page asks the
// gateway who is signed in only once.
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHostedAccount } from './useHostedAccount';
import { useToast } from '../state/AppData';
import { shareGame, type ShareRequest } from '../lib/share';

export interface Sharer {
  /** True behind the torre.sh gateway: shares are public links. */
  hosted: boolean;
  /** True while a link is being made. */
  busy: boolean;
  share: (request: ShareRequest) => Promise<void>;
}

/** `fallback` is what sharing does on your own computer, such as copying the game's PGN. */
export function useShare(fallback: () => void | Promise<void>): Sharer {
  const { t } = useTranslation('common');
  const hosted = useHostedAccount() !== null;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const share = useCallback(async (request: ShareRequest) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await shareGame(request, {
        hosted, toast, fallback,
        messages: {
          copied: t('share.copied'),
          failed: { signedOut: t('share.signedOut'), notFound: t('share.notFound'), tooMany: t('share.tooMany'), failed: t('share.failed') },
        },
      });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [hosted, toast, t, fallback]);

  return useMemo(() => ({ hosted, busy, share }), [hosted, busy, share]);
}
