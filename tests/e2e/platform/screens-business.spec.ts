import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { BUSINESS_SCREENS } from '@ui/screens';
import { test } from '@fixtures';
import { runScreenSweep } from '../support/screen-sweep';

/**
 * Deep UI sweep of the BUSINESS_S-session screens, gated by `BUSINESS_UI_LIFECYCLE=true` and a
 * configured BUSINESS_S account. Not yet on the UI filing allow-list.
 */
test.describe(
  'KPost deep UI sweep — business screens (BUSINESS_S session)',
  { tag: ['@ui', '@platform', '@regression'] },
  () => {
    test.use({ storageState: STORAGE_STATE_BUSINESS });

    test.skip(
      process.env.BUSINESS_UI_LIFECYCLE !== 'true',
      'needs the BUSINESS_S admin session; set BUSINESS_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.businessSKpostId || testData.businessSKpostId.includes('qa.business'),
      'needs the BUSINESS_S account (QA_BUSINESS_S_KPOST_ID)',
    );

    runScreenSweep(BUSINESS_SCREENS, { session: 'business' });
  },
);
