import { STORAGE_STATE_BUSINESS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { BUSINESS_SCREENS } from '@ui/screens';
import { test } from '@fixtures';
import { runScreenSweep } from './support/screen-sweep';

/**
 * Deep UI sweep of the BUSINESS_S-session screens (User Management today). Runs in the company-admin
 * session saved by `auth-business.setup.ts`, so it is gated the same way as the other business specs:
 * `BUSINESS_UI_LIFECYCLE=true` (set by every `ui*` product command) and a configured BUSINESS_S account
 * (kept under `QATEST_ONLY` since 2026-10-10). Added 2026-10-10 with the registry extension.
 *
 * Not yet on the reporter's UI filing allow-list (needs clean runs first; see bug-filing.md).
 */
test.describe('KPost deep UI sweep — business screens (BUSINESS_S session)', { tag: '@ui' }, () => {
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
});
