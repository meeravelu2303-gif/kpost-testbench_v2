import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { test } from '@fixtures';
import { runScreenSweep } from './support/screen-sweep';

/**
 * Deep UI sweep, batch 3 of 3 (KBooking, KNews, ECommerce, KDirectory) — see `screen-sweep.ts` for
 * why this sweep is split into batches and paced between screens.
 */
const BATCH = new Set(['kbooking', 'knews', 'ecommerce', 'kdirectory']);

test.describe(
  'KPost deep UI sweep — batch 3 (KBooking, KNews, ECommerce, KDirectory)',
  { tag: '@ui' },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    runScreenSweep(AUTHENTICATED_SCREENS.filter((s) => BATCH.has(s.name.toLowerCase())));
  },
);
