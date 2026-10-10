import { PUBLIC_SCREENS } from '@ui/screens';
import { test } from '@fixtures';
import { runScreenSweep } from './support/screen-sweep';

/**
 * Deep UI sweep of the PUBLIC screens — login, signup, the child-safety policy, the Kall window in
 * its signed-out state, and the KPoster demo — with no session at all. The full check catalogue
 * (health, performance, layout, accessibility, content, images, security, console, DOM) runs on
 * each, exactly as on the authenticated screens. Added 2026-10-10 when the registry was extended to
 * every route in the front-end map; selectors from a live probe the same day.
 *
 * Not yet on the reporter's UI filing allow-list (needs clean runs first; see bug-filing.md).
 */
test.describe('KPost deep UI sweep — public screens (no session)', { tag: '@ui' }, () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  runScreenSweep(PUBLIC_SCREENS, { session: 'public' });
});
