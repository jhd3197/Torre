// When Torre runs behind a sign-in gateway (torre.sh), the gateway answers auth/me with the
// signed-in account. Running on your own computer, nothing answers it and this stays null.
import { useEffect, useState } from 'react';

export interface HostedAccount {
  name: string;
  email: string;
  admin: boolean;
}

export function useHostedAccount(): HostedAccount | null {
  const [account, setAccount] = useState<HostedAccount | null>(null);
  useEffect(() => {
    let live = true;
    fetch('auth/me')
      .then(response => response.ok && response.headers.get('Content-Type')?.includes('json') ? response.json() : null)
      .then((data: Partial<HostedAccount> | null) => {
        if (live && data && typeof data.email === 'string') {
          setAccount({ name: data.name || data.email, email: data.email, admin: data.admin === true });
        }
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return account;
}

/** "Juan Denis" -> "JD", "rooky" -> "R". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0]?.[0] ?? '?').toUpperCase();
}
