// Drawn chevrons for move navigation buttons, in place of text glyphs; they
// take the button's text colour.
const PATHS = {
  first: 'M17 6l-6 6 6 6M7 6v12',
  previous: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  last: 'M7 6l6 6-6 6M17 6v12',
};

export function NavIcon({ to, size = 16 }: { to: keyof typeof PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[to]} />
    </svg>
  );
}
