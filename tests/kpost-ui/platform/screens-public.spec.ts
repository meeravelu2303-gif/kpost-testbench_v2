import { PUBLIC_SCREENS } from '@ui/screens';
import { test } from '@fixtures';
import { runScreenSweep } from '../support/screen-sweep';

/**
 * Deep UI sweep of the public screens with no session. Not yet on the UI filing allow-list.
 */
test.describe(
  'KPost deep UI sweep — public screens (no session)',
  { tag: ['@ui', '@platform', '@regression'] },
  () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    runScreenSweep(PUBLIC_SCREENS, { session: 'public' });
  },
);
