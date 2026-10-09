import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { test } from '@fixtures';
import { runScreenSweep } from './support/screen-sweep';

/**
 * Deep UI sweep, batch 2 of 3 (Settings, KDiary, KDoc, KCloud) — see `screen-sweep.ts` for why this
 * sweep is split into batches and paced between screens.
 */
const BATCH = new Set(['settings', 'kdiary', 'kdoc', 'kcloud']);

test.describe('KPost deep UI sweep — batch 2 (Settings, KDiary, KDoc, KCloud)', { tag: '@ui' }, () => {
  test.skip(
    !testData.kpostId || testData.kpostId.includes('qa.bench'),
    'needs a real live account (QA_KPOST_ID)',
  );

  runScreenSweep(AUTHENTICATED_SCREENS.filter((s) => BATCH.has(s.name.toLowerCase())));
});
