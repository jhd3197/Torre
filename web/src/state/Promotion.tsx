// "Promote to" picker, awaited like a function: `const piece = await choose('white')`.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '../components/Dialog';
import { pieceNames } from '../lib/boardTools';
import type { Color } from '../types';
import { pieceSrc, usePieceSet } from '../lib/pieces';

type Choose = (color: Color) => Promise<string | null>;
const PromotionContext = createContext<Choose>(() => Promise.resolve('q'));

export const usePromotion = () => useContext(PromotionContext);

export function PromotionProvider({ children }: { children: ReactNode }) {
  const [color, setColor] = useState<Color | null>(null);
  const resolver = useRef<((piece: string | null) => void) | null>(null);

  const choose = useCallback<Choose>(next => new Promise(resolve => {
    resolver.current?.(null);
    resolver.current = resolve;
    setColor(next);
  }), []);

  const finish = (piece: string | null) => {
    resolver.current?.(piece);
    resolver.current = null;
    setColor(null);
  };

  const pieceSet = usePieceSet();
  return (
    <PromotionContext.Provider value={choose}>
      {children}
      <Dialog id="promotion-dialog" open={color !== null} onClose={() => finish(null)}>
        <h2>Promote to</h2>
        <div id="promotion-options" className={`pieces-${pieceSet}`}>
          {['q', 'r', 'b', 'n'].map(p => (
            <button key={p} type="button" aria-label={`Promote to ${pieceNames[p]}`} onClick={() => finish(p)}>
              <img alt="" src={pieceSrc(color === 'white' ? p.toUpperCase() : p, pieceSet)} />
            </button>
          ))}
        </div>
      </Dialog>
    </PromotionContext.Provider>
  );
}
