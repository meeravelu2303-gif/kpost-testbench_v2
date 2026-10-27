import { TAGS } from '@config/constants';
import { expect, test } from '@fixtures';
import { gotoKoolKall, meetingTitleField, openCreateKall } from '../support/kall';
import { requirePersonalAccount } from './smoke-ui';

/**
 * UI SMOKE · Kall — the scheduling entry point works: the Kool Kall tab opens and its "Create Kool
 * Kall" form is ready to fill. Read-only (the form is closed without submitting).
 *
 * A real two-browser call is left to `journeys/voice-call.spec.ts` (known defect #1680 blocks it).
 */
test.describe(
  'SMOKE · UI · Kall',
  { tag: [TAGS.ui, TAGS.kall, TAGS.smoke, TAGS.sanity, TAGS.regression] },
  () => {
    requirePersonalAccount();

    test('the Kool Kall scheduling form opens, ready to fill', async ({ page }) => {
      await gotoKoolKall(page);
      const modal = await openCreateKall(page);
      expect(modal, 'the "Create Kool Kall" form opens').not.toBeNull();
      await expect(meetingTitleField(modal!), 'the meeting title field is ready').toBeEditable({
        timeout: 15_000,
      });
      await page.keyboard.press('Escape');
    });
  },
);
