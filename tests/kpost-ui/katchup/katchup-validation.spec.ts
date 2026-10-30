import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { openComposer } from '../support/katchup';
import { sendsWithin, toast } from '../support/validation';

/**
 * Katchup compose refuses a post with nothing in it (WriteMessage.js): a subject with an empty
 * message is not sent, and the user is told why. sendMessage is blocked at the network, so a message
 * the screen wrongly lets through is never delivered.
 */

const SEND = '/katchup/sendMessage';

test.describe(
  'KPost Katchup · compose refuses an empty message',
  { tag: ['@ui', '@katchup', '@regression'] },
  () => {
    test.skip(!testData.victimKpostId, 'needs the 2nd QA account (QA_VICTIM_KPOST_ID)');

    test('a subject with no message is refused and not sent', async ({ page }) => {
      await page.route(`**${SEND}**`, (route) => route.abort());
      await openComposer(page);
      await page
        .getByRole('textbox', { name: 'Subject' })
        .first()
        .fill('QA validation: empty message');
      const sent = sendsWithin(page, SEND);
      await page.getByRole('button', { name: 'Send message' }).first().click();
      await expect(
        toast(page, 'Please enter a message to post'),
        'the user is told why',
      ).toBeVisible({
        timeout: 10_000,
      });
      expect(await sent, 'an empty message never reaches the server').toBe(false);
    });
  },
);
