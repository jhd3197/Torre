// The coach's words on screen while it speaks, when Captions is on (Settings → Coach & voice).
// Screen readers skip it: the line is already heard.
import { captions, useCaption } from '../lib/captions';

export function Captions() {
  const on = captions.use();
  const text = useCaption();
  if (!on || !text) return null;
  return <div className="captions" aria-hidden="true"><p>{text}</p></div>;
}
