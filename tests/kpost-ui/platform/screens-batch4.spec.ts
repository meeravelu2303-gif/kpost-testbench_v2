import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { test } from '@fixtures';
import { runScreenSweep } from '../support/screen-sweep';

/**
 * Deep UI sweep, batch 4 (WriteMail, KPoster, NotFound; personal session). Not yet on the UI filing
 * allow-list, so its failures are read in the report.
 */
const BATCH = new Set(['writemail', 'kposter', 'notfound']);

test.describe(
  'KPost deep UI sweep — batch 4 (WriteMail, KPoster, NotFound)',
  { tag: ['@ui', '@platform', '@regression'] },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    runScreenSweep(AUTHENTICATED_SCREENS.filter((s) => BATCH.has(s.name.toLowerCase())));
  },
);
