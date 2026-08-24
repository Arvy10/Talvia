import { describe, expect, it } from 'vitest';

import { shouldRefreshAfterPageRestore } from './RefreshOnBfcache';

describe('shouldRefreshAfterPageRestore', () => {
  it('refreshes a page restored from the browser back-forward cache', () => {
    expect(shouldRefreshAfterPageRestore({ persisted: true } as PageTransitionEvent)).toBe(true);
  });

  it('leaves an ordinary page load alone', () => {
    expect(shouldRefreshAfterPageRestore({ persisted: false } as PageTransitionEvent)).toBe(false);
  });
});
