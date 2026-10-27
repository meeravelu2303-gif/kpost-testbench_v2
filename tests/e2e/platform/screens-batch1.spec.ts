import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { test } from '@fixtures';
import { runScreenSweep } from '../support/screen-sweep';

/**
 * Deep UI sweep, batch 1 of 3 (Home, Katchup, Kall, KMail, Profile) — see `screen-sweep.ts` for why
 * this sweep is split into batches and paced between screens.
 */
const BATCH = new Set(['home', 'katchup', 'kall', 'kmail', 'profile']);

test.describe(
  'KPost deep UI sweep — batch 1 (Home, Katchup, Kall, KMail, Profile)',
  { tag: ['@ui', '@platform', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    runScreenSweep(AUTHENTICATED_SCREENS.filter((s) => BATCH.has(s.name.toLowerCase())));
  },
);
