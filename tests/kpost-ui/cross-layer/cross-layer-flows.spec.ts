import { STORAGE_STATE_2 } from '@config/constants';
import { testData } from '@config/test-data.config';
import { text } from '@database/kpost-assertions';
import { expect, test } from '@fixtures';
import type { Locator } from '@playwright/test';
import { gotoContacts, openCreateGroup } from '../support/contacts';
import {
  postAsPage,
  requireKpostDb,
  rowSummary,
  rowWhen,
  storedUtcMs,
} from '../support/cross-layer';
import { gotoKoolKall, meetingTitleField, openCreateKall } from '../support/kall';
import {
  deleteSentMessage,
  messageBySubject,
  openComposerFor,
  sendMessage,
} from '../support/katchup';
import {
  deleteOpenMail,
  deleteOpenSentMail,
  openMail,
  openSession,
  sendMailFromUi,
} from '../journeys/support/journey';
import { retryOrSkip } from '../../support/live-condition';

/**
 * UI -> API -> DB for Katchup, KMail, Group and Kool Kall: what is sent on screen must be stored
 * exactly, and an on-screen delete recorded per participant. Gated; writes real data and cleans up.
 * No `endpoints` call is made as A or B: an API login for the same account signs its browser out.
 */
const FLAGGED = (v: unknown): boolean =>
  ['1', 'y', 'yes', 'true'].includes(String(text(v) ?? v).toLowerCase());

test.describe(
  'KPost cross-layer · Katchup and KMail (UI → API → DB)',
  { tag: ['@ui', '@katchup', '@kmail', '@regression'] },
  () => {
    test.describe.configure({ timeout: 180_000 });
    test.skip(
      process.env.KATCHUP_UI_LIFECYCLE !== 'true' || process.env.KMAIL_UI_LIFECYCLE !== 'true',
      'sends real messages and mails; set KATCHUP_UI_LIFECYCLE=true and KMAIL_UI_LIFECYCLE=true',
    );
    test.skip(
      !testData.kpostId || testData.kpostId.includes('qa.bench') || !testData.victimKpostId,
      'needs both QA accounts',
    );

    test(
      'a Katchup message sent on screen is stored as sent, and a delete on screen is recorded per participant @ui',
      {
        annotation: [
          {
            type: 'cross-layer',
            description:
              'Katchup: send + delete on screen → sendMessage / deleteMessage → TBL_KPOST_KATCHUP_MESSAGES',
          },
        ],
      },
      async ({ page, databases }) => {
        const db = requireKpostDb(databases);
        const subject = `QA cross-layer chat ${Date.now()}`;
        const body = 'QA cross-layer — self-cleaning';
        type MessageRow = {
          msg_id: unknown;
          sender: unknown;
          receiver: unknown;
          subject: unknown;
          actual_message: unknown;
          deleted_by_sender: unknown;
          deleted_by_receiver: unknown;
        };
        let msgId: string | undefined;
        const messageRow = (ok: (r: MessageRow | undefined) => boolean, message: string) =>
          rowWhen<MessageRow>(
            db,
            'SELECT msg_id, sender, receiver, subject, actual_message, deleted_by_sender, deleted_by_receiver FROM TBL_KPOST_KATCHUP_MESSAGES WHERE msg_id = ?',
            [msgId],
            ok,
            message,
          );

        await openComposerFor(page, testData.victimKpostId);
        // Layer 2: the send the screen makes, and its answer.
        const sent = page.waitForResponse(
          (r) =>
            r.request().method() === 'POST' &&
            /\/katchup\/send/i.test(r.url()) &&
            (r.request().postData() ?? '').includes(subject),
          { timeout: 30_000 },
        );
        await sendMessage(page, subject, body);
        const sendResponse = await sent;
        test.info().annotations.push({
          type: 'observed',
          description: `send: ${new URL(sendResponse.url()).pathname} → HTTP ${sendResponse.status()}`,
        });
        expect(sendResponse.status(), 'the server accepts the message').toBeLessThan(300);

        try {
          // The sent message's element id is its msgID (support/katchup.ts).
          msgId = (await messageBySubject(page, subject).getAttribute('id')) ?? undefined;
          expect(msgId, 'the sent message carries its msgID on screen').toBeTruthy();

          // Layer 3: the row holds exactly what was sent, from A to B, not deleted.
          const stored = await messageRow(
            (r) => r !== undefined,
            `TBL_KPOST_KATCHUP_MESSAGES holds msg_id ${msgId}`,
          );
          test.info().annotations.push({
            type: 'observed',
            description: `row after send: ${rowSummary(stored, ['msg_id', 'sender', 'receiver', 'subject', 'deleted_by_sender'])}`,
          });
          expect(text(stored?.subject), 'the Subject is stored as typed').toBe(subject);
          expect(text(stored?.actual_message) ?? '', 'the body is stored as typed').toContain(body);
          expect(text(stored?.sender), 'the sender is the signed-in account').toBe(
            testData.kpostId,
          );
          expect(text(stored?.receiver), 'the receiver is the chosen contact').toBe(
            testData.victimKpostId,
          );
          expect(FLAGGED(stored?.deleted_by_sender), 'not deleted yet').toBe(false);
        } finally {
          // Layer 1 again: delete on screen.
          await deleteSentMessage(page, subject).catch(() => undefined);
        }

        // Layer 3: the delete is per participant — flagged for the sender, the row kept for B.
        const afterDelete = await messageRow(
          (r) => r === undefined || FLAGGED(r.deleted_by_sender),
          'after Delete on screen, deleted_by_sender is set',
        );
        test.info().annotations.push({
          type: 'observed',
          description: `row after delete: ${rowSummary(afterDelete, ['msg_id', 'deleted_by_sender', 'deleted_by_receiver'])}`,
        });
        expect(
          afterDelete,
          "the row survives for the recipient (a sender's delete is not a hard delete)",
        ).toBeDefined();
        expect(
          FLAGGED(afterDelete?.deleted_by_receiver),
          'and it is not deleted for the recipient',
        ).toBe(false);
      },
    );

    test(
      'a KMail sent on screen is stored as sent, and each side’s delete on screen is recorded @ui',
      {
        annotation: [
          {
            type: 'cross-layer',
            description:
              'KMail: send + delete on screen → postMail / delete → TBL_KPOST_KMAIL_MASTER + TBL_KPOST_KMAIL_TRANSACTION',
          },
        ],
      },
      async ({ page, browser, databases }) => {
        const db = requireKpostDb(databases);
        const stamp = Date.now();
        const subject = `QA cross-layer mail ${stamp}`;
        const body = `QA cross-layer mail body ${stamp}`;
        type MailRow = {
          kmail_id: unknown;
          kmail_subject: unknown;
          sender: unknown;
          receiver: unknown;
          delivery_status: unknown;
          deleted_by_sender: unknown;
          deleted_by_receiver: unknown;
        };
        // Layers 1 + 2: send on screen, capturing the answer (its kmailID).
        const posted = page.waitForResponse((r) => r.url().includes('/sentMail/postMail'), {
          timeout: 60_000,
        });
        const request = await sendMailFromUi(page, testData.victimKpostId, subject, body);
        const postResponse = await posted;
        const answer = (await postResponse.json().catch(() => ({}))) as {
          data?: Array<{ kmailID?: number }>;
        };
        const kmailId = answer.data?.[0]?.kmailID;
        const mailRow = (ok: (r: MailRow | undefined) => boolean, message: string) =>
          rowWhen<MailRow>(
            db,
            'SELECT m.kmail_id, m.kmail_subject, t.sender, t.receiver, t.delivery_status, t.deleted_by_sender, t.deleted_by_receiver ' +
              'FROM TBL_KPOST_KMAIL_MASTER m JOIN TBL_KPOST_KMAIL_TRANSACTION t ON t.kmail_id = m.kmail_id WHERE m.kmail_id = ?',
            [kmailId],
            ok,
            message,
          );

        test.info().annotations.push({
          type: 'observed',
          description: `postMail → HTTP ${postResponse.status()}, kmailID ${String(kmailId)}; sent subject "${String(request.kmailSubject)}", to "${String(request.toAddress)}"`,
        });
        expect(kmailId, 'the server returns the new mail id').toBeTruthy();

        const b = await openSession(browser, STORAGE_STATE_2);
        try {
          // Layer 3: the master row has the subject; the transaction says A → B, delivered, not deleted.
          const stored = await mailRow(
            (r) => r !== undefined,
            `TBL_KPOST_KMAIL_MASTER/TRANSACTION hold kmail_id ${String(kmailId)}`,
          );
          test.info().annotations.push({
            type: 'observed',
            description: `row after send: ${rowSummary(stored, ['kmail_id', 'kmail_subject', 'sender', 'receiver', 'delivery_status', 'deleted_by_sender', 'deleted_by_receiver'])}`,
          });
          // kmail_subject is encrypted at rest (no key here); B finding the mail by subject proves it.
          expect(text(stored?.kmail_subject) ?? '', 'the Subject is stored').not.toBe('');
          expect(text(stored?.kmail_subject), 'and encrypted at rest, not as plaintext').not.toBe(
            subject,
          );
          expect(text(stored?.sender), 'the sender is the signed-in account').toBe(
            testData.kpostId,
          );
          expect(text(stored?.receiver), 'the receiver is the addressed account').toBe(
            testData.victimKpostId,
          );
          expect(
            FLAGGED(stored?.deleted_by_sender) || FLAGGED(stored?.deleted_by_receiver),
            'not deleted yet',
          ).toBe(false);

          // Layer 1 again: A deletes on screen → only A's side is flagged.
          await openMail(page, subject);
          expect(await deleteOpenSentMail(page), "A's delete is accepted").toBe(true);
          const afterA = await mailRow(
            (r) => FLAGGED(r?.deleted_by_sender),
            "after A's delete, deleted_by_sender is set",
          );
          expect(FLAGGED(afterA?.deleted_by_receiver), "B's copy is untouched by A's delete").toBe(
            false,
          );

          // B deletes on screen too → both sides flagged; the row itself stays (soft delete).
          await openMail(b.page, subject);
          expect(await deleteOpenMail(b.page), "B's delete is accepted").toBe(true);
          const afterB = await mailRow(
            (r) => FLAGGED(r?.deleted_by_receiver),
            "after B's delete, deleted_by_receiver is set",
          );
          test.info().annotations.push({
            type: 'observed',
            description: `row after both deletes: ${rowSummary(afterB, ['kmail_id', 'deleted_by_sender', 'deleted_by_receiver'])}`,
          });
        } finally {
          await b.context.close();
        }
      },
    );

    test(
      'a group created on screen is stored with its creator as admin and the chosen member @ui',
      {
        annotation: [
          {
            type: 'cross-layer',
            description:
              'Group: create on screen → createUserGroup → TBL_KPOST_USERGROUP_MASTER + TBL_KPOST_USERGROUP_MEMBERDETAILS',
          },
        ],
      },
      async ({ page, databases }) => {
        test.skip(
          process.env.GROUP_UI_LIFECYCLE !== 'true',
          'creates a real group; set GROUP_UI_LIFECYCLE=true',
        );
        const db = requireKpostDb(databases);
        const name = `QA cross-layer group ${Date.now()}`;
        // Layer 1: Contacts › Create group › name › Add Members (pick B) › Done › Create.
        const opened = await gotoContacts(page);
        retryOrSkip(
          !opened,
          'the Contacts panel was not showing right now (session or load condition)',
        );
        const modal = await openCreateGroup(page);
        expect(modal, 'the Create New Group modal opens').not.toBeNull();
        await modal!.getByRole('textbox', { name: 'Group Name' }).first().fill(name);
        await modal!
          .getByRole('button', { name: /Add Members/i })
          .first()
          .click();
        const picker = page
          .getByRole('dialog')
          .filter({ hasText: /Add Members/i })
          .last();
        await expect(picker, 'the member picker opens').toBeVisible({ timeout: 15_000 });
        await picker.getByRole('searchbox').first().fill('Qatest2');
        const box = await checkboxFor(picker, /Qatest2\b/i);
        expect(box, 'Qatest2 is offered in the member picker').not.toBeNull();
        await box!.check();
        await picker
          .getByRole('button', { name: /^Done$/i })
          .first()
          .click();

        const form = page.getByRole('dialog').filter({ hasText: /Create New Group/i });
        await expect(
          form.getByText(/Group Members/i).first(),
          'the chosen member is listed',
        ).toBeVisible({
          timeout: 15_000,
        });
        // Layer 2: the create request the screen sends, and its answer.
        const created = page.waitForResponse((r) => r.url().includes('/group/createUserGroup'), {
          timeout: 30_000,
        });
        await form
          .getByRole('button', { name: /^Create$/ })
          .first()
          .click();
        const createResponse = await created;
        const answer = (await createResponse.json().catch(() => ({}))) as {
          data?: { groupID?: number; groupKpostID?: string };
        };
        const group = answer.data ?? {};
        test.info().annotations.push({
          type: 'observed',
          description: `createUserGroup → HTTP ${createResponse.status()}, groupID ${String(group.groupID)}; sent ${String(createResponse.request().postData()).slice(0, 300)}`,
        });

        try {
          expect(createResponse.status(), 'the server accepts the group').toBeLessThan(300);
          expect(group.groupID, 'the server returns the new group id').toBeTruthy();

          // Layer 3: the group row and its member rows.
          type GroupRow = {
            group_id: unknown;
            group_name: unknown;
            admin_kpost_id: unknown;
            created_by: unknown;
            active_status: unknown;
          };
          const stored = await rowWhen<GroupRow>(
            db,
            'SELECT group_id, group_name, admin_kpost_id, created_by, active_status FROM TBL_KPOST_USERGROUP_MASTER WHERE group_id = ?',
            [group.groupID],
            (r) => r !== undefined,
            `TBL_KPOST_USERGROUP_MASTER holds group ${String(group.groupID)}`,
          );
          test.info().annotations.push({
            type: 'observed',
            description: `group row: ${rowSummary(stored, ['group_id', 'group_name', 'admin_kpost_id', 'created_by', 'active_status'])}`,
          });
          expect(text(stored?.group_name)?.toLowerCase(), 'the group name is stored as typed').toBe(
            name.toLowerCase(),
          );
          expect(text(stored?.created_by), 'created by the signed-in account').toBe(
            testData.kpostId,
          );

          const members = await db.query<{ kpost_id: unknown; admin_access: unknown }>(
            'SELECT kpost_id, admin_access FROM TBL_KPOST_USERGROUP_MEMBERDETAILS WHERE group_id = ?',
            [group.groupID],
          );
          test.info().annotations.push({
            type: 'observed',
            description: `member rows: ${members.map((m) => rowSummary(m, ['kpost_id', 'admin_access'])).join(' | ')}`,
          });
          const member = (id: string) =>
            members.find((m) => String(text(m.kpost_id)).toLowerCase() === id.toLowerCase());
          expect(
            FLAGGED(member(testData.kpostId)?.admin_access),
            'the creator is an admin member',
          ).toBe(true);
          expect(
            member(testData.victimKpostId),
            'the member chosen on screen is a member',
          ).toBeDefined();
          expect(
            FLAGGED(member(testData.victimKpostId)?.admin_access),
            'as a plain member (no admin access)',
          ).toBe(false);
        } finally {
          // Members out first (delete is refused while any remain), via the page's own session.
          if (group.groupID && group.groupKpostID) {
            const ids = { groupID: group.groupID, groupKpostID: group.groupKpostID };
            await postAsPage(page, '/v2/group/removeGroupMember/', {
              ...ids,
              memberKpostIdList: [testData.victimKpostId],
            }).catch(() => undefined);
            await postAsPage(page, '/v2/group/deleteGroup', ids).catch(() => undefined);
          }
        }
      },
    );

    test(
      'a Kool Kall scheduled on screen is stored with its organizer, time and invitee @ui',
      {
        annotation: [
          {
            type: 'cross-layer',
            description:
              'Kall: schedule a Kool Kall on screen → scheduledKall → TBL_KPOST_KOOL_KALL_MASTER + TBL_KPOST_KOOL_KALL_DETAILS',
          },
        ],
      },
      async ({ page, databases }) => {
        test.skip(
          process.env.KALL_UI_LIFECYCLE !== 'true',
          'creates a real scheduled call; set KALL_UI_LIFECYCLE=true',
        );
        const db = requireKpostDb(databases);
        const title = `QA cross-layer kall ${Date.now()}`;
        const tomorrow = new Date(Date.now() + 24 * 3600_000);
        const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

        // Layer 1: Kool Kall › Create › title, tomorrow 10:00–10:30 › Invite (pick B) › Done › Submit.
        await gotoKoolKall(page);
        const modal = await openCreateKall(page);
        expect(modal, 'the schedule modal opens').not.toBeNull();
        await meetingTitleField(modal!).fill(title);
        await modal!.locator('input[name="birthday"]').first().fill(day);
        const times = modal!.locator('input[type="time"]');
        await times.nth(0).fill('10:00');
        await times.nth(1).fill('10:30');
        await modal!
          .getByText(/^Invite$/)
          .first()
          .click();
        const picker = page
          .getByRole('dialog')
          .filter({ hasText: /Invite Participants/i })
          .last();
        await expect(picker, 'the participant picker opens').toBeVisible({ timeout: 15_000 });
        await picker
          .getByRole('searchbox')
          .first()
          .fill('Qatest2')
          .catch(() => undefined);
        const box = await checkboxFor(picker, /Qatest2\b/i);
        expect(box, 'Qatest2 is offered in the participant picker').not.toBeNull();
        await box!.check();
        await picker
          .getByRole('button', { name: /^Done$/i })
          .first()
          .click();

        // Layer 2: the schedule request the screen sends, and its answer.
        const scheduled = page.waitForResponse((r) => r.url().includes('/kall/scheduledKall'), {
          timeout: 30_000,
        });
        await modal!
          .getByRole('button', { name: /^Submit$/i })
          .first()
          .click();
        const response = await scheduled;
        const answer = (await response.json().catch(() => ({}))) as {
          data?: { kallID?: number; id?: number } | Array<{ kallID?: number; id?: number }>;
        };
        const data = Array.isArray(answer.data) ? answer.data[0] : answer.data;
        const kallId = data?.kallID ?? data?.id;
        test.info().annotations.push({
          type: 'observed',
          description: `scheduledKall → HTTP ${response.status()}, kallID ${String(kallId)}; sent ${String(response.request().postData()).slice(0, 300)}`,
        });

        try {
          expect(response.status(), 'the server accepts the schedule').toBeLessThan(300);
          expect(kallId, 'the server returns the new kall id').toBeTruthy();

          // Layer 3: the master row (organizer, subject, time) and the invitee's detail row.
          type KallRow = {
            kall_id: unknown;
            sender: unknown;
            subject: unknown;
            scheduled_start_time: unknown;
            delete_by_sender: unknown;
          };
          const stored = await rowWhen<KallRow>(
            db,
            'SELECT kall_id, sender, subject, scheduled_start_time, delete_by_sender FROM TBL_KPOST_KOOL_KALL_MASTER WHERE kall_id = ?',
            [kallId],
            (r) => r !== undefined,
            `TBL_KPOST_KOOL_KALL_MASTER holds kall ${String(kallId)}`,
          );
          test.info().annotations.push({
            type: 'observed',
            description: `kall row: ${rowSummary(stored, ['kall_id', 'sender', 'subject', 'scheduled_start_time', 'delete_by_sender'])}`,
          });
          expect(text(stored?.subject), 'the meeting title is stored as typed').toBe(title);
          expect(text(stored?.sender), 'the organizer is the signed-in account').toBe(
            testData.kpostId,
          );
          const sentStart = (
            JSON.parse(response.request().postData() ?? '{}') as { scheduledStartTime?: number }
          ).scheduledStartTime;
          expect(
            storedUtcMs(stored?.scheduled_start_time),
            'the stored start time is exactly the time the screen sent',
          ).toBe(sentStart);

          const invitees = await db.query<{ receiver: unknown; receiver_kall_status: unknown }>(
            'SELECT receiver, receiver_kall_status FROM TBL_KPOST_KOOL_KALL_DETAILS WHERE kall_id = ?',
            [kallId],
          );
          test.info().annotations.push({
            type: 'observed',
            description: `invitee rows: ${invitees.map((i) => rowSummary(i, ['receiver', 'receiver_kall_status'])).join(' | ')}`,
          });
          expect(
            invitees.some(
              (i) =>
                String(text(i.receiver)).toLowerCase() === testData.victimKpostId.toLowerCase(),
            ),
            'the participant chosen on screen is invited',
          ).toBe(true);
        } finally {
          // `kallID` alone: sending `id` too makes endKoolKall answer 500.
          if (kallId)
            await postAsPage(page, '/v2/kall/endKoolKall', { kallID: kallId }).catch(
              () => undefined,
            );
        }
      },
    );
  },
);

/** The checkbox in `scope` whose row text matches `label` (each checkbox paired with its nearest text). */
async function checkboxFor(scope: Locator, label: RegExp): Promise<Locator | null> {
  const boxes = scope.getByRole('checkbox');
  await boxes
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => undefined);
  const labels = await boxes.evaluateAll((els) =>
    els.map((el) => {
      let node: HTMLElement | null = el.parentElement;
      while (node && (node.innerText ?? '').trim().length < 3) node = node.parentElement;
      return (node?.innerText ?? '').replace(/\s+/g, ' ').trim();
    }),
  );
  const at = labels.findIndex((l) => label.test(l));
  return at >= 0 ? boxes.nth(at) : null;
}
