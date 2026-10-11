// A small flag for each app language, drawn inline so it looks the same everywhere
// (flag emoji show up as plain letters on Windows). English uses the US flag and
// Español the Mexican one, since the Spanish is Latin American.
import type { Language } from '../i18n';

const STRIPES = Array.from({ length: 7 }, (_, i) => i * 2);

function UnitedStates() {
  return (
    <>
      <rect width="30" height="20" fill="#fff" />
      {STRIPES.map(i => <rect key={i} y={(i * 20) / 13} width="30" height={20 / 13} fill="#b22234" />)}
      <rect width="12" height={(20 * 7) / 13} fill="#3c3b6e" />
      {[[2, 2], [6, 2], [10, 2], [4, 4.5], [8, 4.5], [2, 7], [6, 7], [10, 7], [4, 9.5], [8, 9.5]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="0.75" fill="#fff" />
      ))}
    </>
  );
}

function Mexico() {
  return (
    <>
      <rect width="10" height="20" fill="#006847" />
      <rect x="10" width="10" height="20" fill="#fff" />
      <rect x="20" width="10" height="20" fill="#ce1126" />
      {/* The coat of arms, simplified: an eagle-brown disc on a green wreath. */}
      <circle cx="15" cy="10.4" r="3.1" fill="none" stroke="#5e8c3a" strokeWidth="0.9" />
      <circle cx="15" cy="10" r="2" fill="#8c5a2b" />
    </>
  );
}

export function Flag({ lang, size = 28 }: { lang: Language | string; size?: number }) {
  return (
    <svg className="flag-icon" width={size} height={(size * 2) / 3} viewBox="0 0 30 20" aria-hidden="true">
      <clipPath id={`flag-clip-${lang}`}><rect width="30" height="20" rx="3" /></clipPath>
      <g clipPath={`url(#flag-clip-${lang})`}>{lang === 'es' ? <Mexico /> : <UnitedStates />}</g>
      <rect width="30" height="20" rx="3" fill="none" stroke="#0000001f" />
    </svg>
  );
}
