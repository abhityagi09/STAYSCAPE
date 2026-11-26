import { useEffect } from 'react';

const SITE = 'STAYSCAPE';
export const DEFAULT_TITLE = 'STAYSCAPE — Stays worth the journey';

/**
 * Keeps document.title in step with in-app navigation. The first page load already has the
 * right title from the server-side include (see index.html); this covers later navigations.
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    document.title = title === SITE || title === DEFAULT_TITLE ? title : `${title} · ${SITE}`;
  }, [title]);
}
