import { testData } from '@config/test-data.config';
import { AUTHENTICATED_SCREENS } from '@ui/screens';
import { test } from '@fixtures';
import { runScreenSweep } from './support/screen-sweep';

/**
 * Deep UI sweep, batch 4 (WriteMail, KPoster, NotFound) — the PERSONAL-session screens added on
 * 2026-10-10 when the registry was extended to every route in the front-end map. Same shared body
 * and pacing as batches 1–3 (`screen-sweep.ts`).
 *
 * Not yet on the reporter's UI filing allow-list: a new sweep earns that after clean runs on all
 * three browsers (docs/guides/bug-filing.md). Until then its failures are read in the report.
 */
const BATCH = new Set(['writemail', 'kposter', 'notfound']);

test.describe(
  'KPost deep UI sweep — batch 4 (WriteMail, KPoster, NotFound)',
  { tag: '@ui' },
  () => {
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench'),
      'needs a real live account (QA_KPOST_ID)',
    );

    runScreenSweep(AUTHENTICATED_SCREENS.filter((s) => BATCH.has(s.name.toLowerCase())));
  },
);
