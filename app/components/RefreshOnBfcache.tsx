'use client';

import { useEffect } from 'react';

export function shouldRefreshAfterPageRestore(event: PageTransitionEvent) {
  return event.persisted;
}

export default function RefreshOnBfcache() {
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (shouldRefreshAfterPageRestore(event)) window.location.reload();
    }

    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  return null;
}
