'use client';

// Tiny SSR-safe media-query hooks. Used to disable drag-and-drop and collapse
// the grid to a single column on small screens (Section 4 — Responsiveness).

import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

// < 768px — phones. Drag disabled, single-column stacked layout.
export const useIsMobile = () => useMediaQuery('(max-width: 767px)');
// 768–1024px — tablets. 2-column grid.
export const useIsTablet = () => useMediaQuery('(min-width: 768px) and (max-width: 1024px)');
