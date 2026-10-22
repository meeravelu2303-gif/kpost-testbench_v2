import { STORAGE_STATE_2, TAGS } from '@config/constants';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import {
  deleteOpenMail,
  deleteOpenSentMail,
  openMail,
  openSession,
  sendMailFromUi,
} from '../journeys/support/journey';
import { requirePersonalAccount } from './smoke-ui';

/**
 * UI SMOKE · KMail — qatest1 writes and sends a mail on screen, qatest2 opens it in their own inbox,
 * and both delete their copy afterwards (net zero). Proves compose, send, delivery and read.
 */
test.describe(
  'SMOKE · UI · KMail',
  { tag: [TAGS.ui, TAGS.kmail, TAGS.smoke, TAGS.sanity, TAGS.regression] },
  () => {
    requirePersonalAccount();
    test.skip(!testData.victimKpostId, 'needs the second QA account (QA_VICTIM_KPOST_ID)');

    test('a mail sent by one user is delivered to the other and opens', async ({
      page,
      browser,
    }) => {
      test.setTimeout(180_000);
      const stamp = Date.now();
      const subject = `QA smoke mail ${stamp}`;
      const body = `QA smoke mail body ${stamp} — safe to ignore`;
      const request = await sendMailFromUi(page, testData.victimKpostId, subject, body);
      expect(String(request.kmailSubject), 'the app sent the subject that was typed').toBe(subject);

      const b = await openSession(browser, STORAGE_STATE_2);
      try {
        // What the server hands back when the recipient opens the mail: an empty record is the known
        // intermittent fault #1348 (the mail opens with no text), so the failure explains itself.
        const opened: string[] = [];
        b.page.on('response', (r) => {
          if (!r.url().includes('/readMail/sentAndInboxMailContent')) return;
          void r
            .json()
            .then((j: { data?: { kmailID?: number; mailContent?: string } }) =>
              opened.push(
                `kmailID ${String(j.data?.kmailID)}, text ${j.data?.mailContent?.includes(body) ? 'present' : 'MISSING'}`,
              ),
            )
            .catch(() => undefined);
        });
        await openMail(b.page, subject);
        // Opening from search shows the conversation's mail cards; the app expands the newest one only
        // sometimes (live 2026-10-22), so read it the way a person does: click the mail, then read.
        const text = b.page.getByText(body, { exact: false }).first();
        if (!(await text.isVisible().catch(() => false))) {
          await b.page
            .getByText(subject, { exact: false })
            .filter({ visible: true })
            .last()
            .click();
        }
        const readable = await text
          .waitFor({ state: 'visible', timeout: 20_000 })
          .then(() => true)
          .catch(() => false);
        test.info().annotations.push({
          type: 'observed',
          description: `recipient's open request → ${opened.join(' | ') || 'not seen'}`,
        });
        if (!readable) {
          await test.info().attach('recipient-screen', {
            body: await b.page.screenshot(),
            contentType: 'image/png',
          });
        }
        expect(readable, 'the recipient sees the mail text (#1348 when not)').toBe(true);
      } finally {
        await deleteOpenMail(b.page).catch(() => false);
        await b.context.close();
        await openMail(page, subject)
          .then(() => deleteOpenSentMail(page))
          .catch(() => false);
      }
    });
  },
);
