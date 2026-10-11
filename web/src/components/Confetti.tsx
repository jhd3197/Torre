// A one-shot burst of paper for completion screens: ~60 pieces fall once, then
// the overlay removes itself. Pure CSS motion, no dependencies.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';

const PIECES = 60;
const COLORS = ['#2f5d50', '#c9a552', '#f1e3b8', '#9fbf7f', '#d9a58f', '#fffdf8'];
const FALL_MS = 2400;

interface Piece {
  left: number;
  delay: number;
  duration: number;
  size: number;
  color: string;
  drift: number;
  spin: number;
  round: boolean;
}

export function Confetti() {
  const [gone, setGone] = useState(false);
  const pieces = useMemo<Piece[]>(() => Array.from({ length: PIECES }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.35,
    duration: 1.5 + Math.random() * 0.9,
    size: 6 + Math.random() * 6,
    color: COLORS[i % COLORS.length],
    drift: Math.random() * 2 - 1,
    spin: Math.random() * 720 - 360,
    round: Math.random() < 0.3,
  })), []);

  // The burst plays once; the overlay cleans itself up after the last piece lands.
  useEffect(() => {
    const timer = setTimeout(() => setGone(true), FALL_MS + 500);
    return () => clearTimeout(timer);
  }, []);

  if (gone) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((piece, i) => (
        <span key={i} className={`confetti-piece${piece.round ? ' round' : ''}`} style={{
          left: `${piece.left}%`,
          width: piece.size,
          height: piece.round ? piece.size : piece.size * 0.6,
          background: piece.color,
          animationDelay: `${piece.delay}s`,
          animationDuration: `${piece.duration}s`,
          '--drift': `${piece.drift * 90}px`,
          '--spin': `${piece.spin}deg`,
        } as CSSProperties} />
      ))}
    </div>
  );
}
