// A page about one thing (a lesson, a puzzle theme) names it in the top bar,
// after its section, instead of repeating it as a second heading below:
// "Lessons / The rook" rather than "Lessons" over "The rook". Layout owns the
// state and draws the bar.
import { createContext, useContext, useEffect } from 'react';

export interface PageTitle {
  title: string;
  /** Art shown beside the title in place of the section's. */
  art?: string;
}

export const PageTitleContext = createContext<(title: PageTitle | null) => void>(() => {});

/** Names the page in the top bar while it is shown; null keeps the section title alone. */
export function usePageTitle(title: PageTitle | null) {
  const set = useContext(PageTitleContext);
  const name = title?.title;
  const art = title?.art;
  useEffect(() => {
    if (!name) return;
    set({ title: name, art });
    return () => set(null);
  }, [name, art, set]);
}
