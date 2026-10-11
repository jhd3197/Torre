// The toast on shell-less routes. The app shell (Layout) owns the #toast
// element; when a route renders without the shell (story focus mode), this
// mounts the same element instead — but only while the shell's one is absent,
// so the two never duplicate the id.
import { useEffect, useRef, useState } from 'react';
import { useToastMessage } from '../state/AppData';

export function Toast() {
  const toastMessage = useToastMessage();
  const own = useRef<HTMLDivElement>(null);
  const [shellHasToast, setShellHasToast] = useState(true);
  useEffect(() => {
    const mounted = document.getElementById('toast');
    setShellHasToast(Boolean(mounted && mounted !== own.current));
  }, [toastMessage]);
  if (shellHasToast) return null;
  return <div id="toast" ref={own} role="status" className={toastMessage ? 'visible' : ''}>{toastMessage}</div>;
}
