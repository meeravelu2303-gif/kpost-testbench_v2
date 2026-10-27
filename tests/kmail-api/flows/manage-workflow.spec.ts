import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { KMAIL_TYPE } from '@api/contract/kpost-types';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { mailShape } from '@api/definitions/kmail/send.api';

/**
 * KMail manage writes not covered elsewhere: status clearing, PDF conversion, other-domain contact
 * CRUD, OD attachment download and bulk send. Gated by KMAIL_LIFECYCLE=true (real KMail writes).
 */

const K = AUTH_PROFILES.kpost;
const p = (key: string): Principal => K.principals.find((x) => x.key === key)!;
const A = p('personal');
const B = p('victim');

async function act(
  endpoints: EndpointExecutor,
  id: string,
  bodyObj: Record<string, unknown> | undefined,
  label: string,
): Promise<number> {
  const ex = await endpoints.sendTo(id, bodyObj ? { body: bodyObj } : {}, {
    label: `kmail:${label}`,
    auth: { principal: A },
    allowLiveWrite: true,
  });
  return ex.status;
}

test.describe(
  'KMail · manage workflow @api @kmail-api @kmail',
  { tag: ['@api', '@kmail', '@regression'] },
  () => {
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
    test.skip(
      process.env.KMAIL_LIFECYCLE !== 'true',
      'writes real KMail data; set KMAIL_LIFECYCLE=true',
    );

    test('clearStatusOfKmailsContacts and clearStatusOfAllKmailsContacts: `kmailStatusFlag` is required, but no value satisfies it', async ({
      endpoints,
    }) => {
      // A missing kmailStatusFlag must be a 4xx, not a 500. With the flag present, no value (0-4)
      // passes the REPLY_NOT_SENT check; the real contract is still unknown.
      expect
        .soft(
          await act(
            endpoints,
            'kmail-clear-status',
            { selectedContact: B.username },
            'clear-status',
          ),
          'clearStatusOfKmailsContacts does not crash when kmailStatusFlag is omitted (dev-confirmed partial fix)',
        )
        .toBeLessThan(500);
      expect
        .soft(
          await act(
            endpoints,
            'kmail-clear-status',
            { selectedContact: B.username, kmailStatusFlag: 0 },
            'clear-status-with-flag',
          ),
          'clearStatusOfKmailsContacts: exact contract still Unknown/Requires Clarification — kmailStatusFlag present but no value passes REPLY_NOT_SENT',
        )
        .toBeLessThan(400);
      expect
        .soft(
          await act(
            endpoints,
            'kmail-clear-all-status',
            { kmailStatusFlag: 0 },
            'clear-all-status',
          ),
          'clearStatusOfAllKmailsContacts: same Unknown/Requires Clarification contract as clear-status',
        )
        .toBeLessThan(400);
    });

    test('convertMailAsPDF and downloadODAttachment, fed a real kmailID from a compose @api', async ({
      endpoints,
    }) => {
      const sent = await endpoints.sendTo(
        'kmail-post-mail',
        { body: mailShape({ toAddress: B.username, kmailSubject: `QA PDF ${Date.now()}` }) },
        { label: 'kmail:manage-compose', auth: { principal: A }, allowLiveWrite: true },
      );
      expect.soft(sent.status, 'compose succeeds').toBeLessThan(300);
      const parsed = sent.json();
      const value = (parsed.ok ? parsed.value : {}) as { data?: unknown };
      const data = Array.isArray(value.data)
        ? (value.data[0] as Record<string, unknown>)
        : (value.data as Record<string, unknown> | undefined);
      const kmailID = typeof data?.kmailID === 'number' ? data.kmailID : undefined;
      const txns = data?.kmailTransactionList;
      const transactionIDs = Array.isArray(txns)
        ? (txns as Array<Record<string, unknown>>)
            .map((t) => t.transactionID ?? t.id)
            .filter((v): v is number => typeof v === 'number')
        : [];

      try {
        if (kmailID) {
          const pdf = await act(endpoints, 'kmail-convert-pdf', { kmailID }, 'convert-pdf');
          expect
            .soft(pdf, 'convertMailAsPDF returns a status for a real kmailID')
            .toBeLessThan(500);

          // destructive:true (unlike the other "needs-id" reads), so allowLiveWrite already covers it.
          const odAttachment = await act(
            endpoints,
            'kmail-download-od-attachment',
            { kmailID, kmailNumber: 0, kmailType: 'sent', groupFlag: false },
            'download-od-attachment',
          );
          expect
            .soft(odAttachment, 'downloadODAttachment returns a status for a real kmailID')
            .toBeLessThan(500);
        }
      } finally {
        await endpoints
          .sendTo(
            'kmail-delete',
            { body: { groupFlag: false, transactionIDs } },
            { label: 'kmail:manage-cleanup', auth: { principal: A }, allowLiveWrite: true },
          )
          .catch(() => undefined);
      }
    });

    test('other-domain contact: add → edit → delete @api', async ({ endpoints }) => {
      // The QA-identifier guard refuses a stranger's email, so our own address stands in for the
      // external contact (and for referenceName). No read endpoint returns the stored contact name,
      // so the edit can only be asserted as accepted.
      const contactEmailID = testData.kpostId;

      const added = await act(
        endpoints,
        'kmail-add-od-contact',
        { contactEmailID, contactName: 'QA Original Name', referenceName: testData.kpostId },
        'od-add',
      );
      expect.soft(added, 'addOtherDomainContacts is accepted').toBeLessThan(300);

      const edited = await act(
        endpoints,
        'kmail-edit-od-contact',
        { contactEmailID, contactName: `QA Edited Name ${Date.now()}` },
        'od-edit',
      );
      expect.soft(edited, 'editOtherDomainContactsDetails is accepted').toBeLessThan(300);

      const deleted = await act(
        endpoints,
        'kmail-delete-od-contact',
        { contactEmailID },
        'od-delete',
      );
      expect.soft(deleted, 'deleteOtherDomainContact is accepted').toBeLessThan(300);
    });

    test('postBulkMail: sends to multiple recipients with its own, distinct contract @api', async ({
      endpoints,
    }) => {
      // postBulkMail has its own minimal contract, not postMail's shape plus toAddressList.
      // The caller's own address is refused as a recipient, so only the second QA account is used.
      const bulk = await endpoints.sendTo(
        'kmail-post-bulk',
        {
          body: {
            toAddressList: [B.username],
            kmailSubject: `QA Bulk ${Date.now()}`,
            kmailContent: 'QA bench bulk mail body — safe to ignore.',
            priority: 0,
            kmailType: KMAIL_TYPE.bulkmail,
            attachmentUuid: [] as string[],
          },
        },
        { label: 'kmail:post-bulk', auth: { principal: A }, allowLiveWrite: true },
      );
      expect.soft(bulk.status, 'postBulkMail is accepted').toBeLessThan(300);
      // No cleanup: the response carries no id to delete by.

      // bulk-status is keyed by the caller's own address and should report the mail just sent.
      const status = await endpoints.sendTo(
        'kmail-bulk-status',
        { pathParams: { fromAddress: testData.kpostId } },
        { label: 'kmail:bulk-status', auth: { principal: A }, allowLiveRead: true },
      );
      expect
        .soft(status.status, 'bulkMail/status reads back after a real bulk send')
        .toBeLessThan(300);
      const statusBody = JSON.parse(status.bodyText || '{}') as { total?: number };
      expect
        .soft(statusBody.total, 'the status reflects at least the mail just sent')
        .toBeGreaterThan(0);
    });

    test('draftMailMultiPart: no live business-rule test (recorded gap, not a workaround)', () => {
      test.skip(
        true,
        'Dev-confirmed 2026-09-26: this route is not in use — intentionally unavailable on this ' +
          'build, not a deployment gap. testkmail answers a plain Spring 404 "Not Found" for POST ' +
          '/draft/draftMailMultiPart, consistent with that. Not exercised, by design.',
      );
      expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
    });

    test('referenceMailContent: exact request shape is Unknown/Requires Clarification (identifier-guard gap fixed)', async ({
      endpoints,
    }) => {
      // The request shape is unknown: every shape tried with a real kmailID returns 400.
      const composed = await endpoints.sendTo(
        'kmail-post-mail',
        {
          body: mailShape({
            toAddress: B.username,
            kmailSubject: `QA reference-content ${Date.now()}`,
          }),
        },
        { label: 'kmail:reference-content-send', auth: { principal: A }, allowLiveWrite: true },
      );
      expect.soft(composed.status, 'sending the mail to reference succeeds').toBeLessThan(300);
      const parsed = composed.json();
      const value = (parsed.ok ? parsed.value : {}) as { data?: unknown };
      const row = Array.isArray(value.data)
        ? (value.data[0] as Record<string, unknown>)
        : (value.data as Record<string, unknown> | undefined);
      const kmailID = typeof row?.kmailID === 'number' ? row.kmailID : undefined;
      expect.soft(kmailID, 'the composed mail issues a real kmailID to reference').toBeTruthy();

      if (kmailID) {
        const ref = await endpoints.sendTo(
          'kmail-reference-content',
          { body: { referenceMails: [kmailID] } },
          { label: 'kmail:reference-content', auth: { principal: A }, allowLiveRead: true },
        );
        expect
          .soft(
            ref.status,
            'referenceMailContent returns a status (exact required shape: Unknown/Requires Clarification)',
          )
          .toBeLessThan(500);
      }
    });

    test('kmail-download-thumbnail / kmail-media-streaming / kmail-download-attachment: happy path still needs an attachment upload lifecycle; nonexistent-uuid handling is tested', async ({
      endpoints,
    }) => {
      // No way to mint a real attachment uuid here, so only nonexistent-uuid handling is tested.
      // Known defect #604: mediaStreaming 500s on a nonexistent uuid (a 5xx here auto-files).
      const fakeUuids = ['test-uuid', 'no-such-attachment-9f2a', 'another-fake-uuid-123'];
      for (const uuid of fakeUuids) {
        const stream = await endpoints.sendTo(
          'kmail-media-streaming',
          { pathParams: { uuid } },
          { label: `kmail:media-streaming:${uuid}`, auth: { principal: A }, allowLiveRead: true },
        );
        expect
          .soft(stream.status, `mediaStreaming(${uuid}) does not crash on a nonexistent attachment`)
          .toBeLessThan(500);
      }

      const download = await endpoints.sendTo(
        'kmail-download-attachment',
        { pathParams: { uuid: fakeUuids[0]! } },
        { label: 'kmail:download-attachment-fake', auth: { principal: A }, allowLiveRead: true },
      );
      expect
        .soft(download.status, 'downloadAttachment does not crash on a nonexistent attachment')
        .toBeLessThan(500);

      const thumb = await endpoints.sendTo(
        'kmail-download-thumbnail',
        { pathParams: { uuid: fakeUuids[0]! } },
        { label: 'kmail:download-thumbnail-fake', auth: { principal: A }, allowLiveRead: true },
      );
      expect
        .soft(thumb.status, 'downloadThumbnail does not crash on a nonexistent attachment')
        .toBeLessThan(500);
    });

    test('kmail-delete-letterhead: no live test (dev-confirmed shared default; no create endpoint to safely test against)', () => {
      test.skip(
        true,
        'Dev-confirmed 2026-09-26: letterhead id "1" IS the shared system default — "other[s] are ' +
          'should be added by user for their own customization." This matches the evidence already on ' +
          'file (getLetterHead marks id 1 `"default":"Y"` at a generic S3 path). So deleting id 1 is ' +
          'confirmed unsafe, exactly as suspected — not a remaining open question. What blocks a live ' +
          'test now is narrower: the KMail OpenAPI contract and workbook register only ' +
          'get-all/get-current/get-template/set-active-by-id/delete-by-id for letterheads — no ' +
          'create/save/upload route a user would call to add their own, so this bench has no way to ' +
          'create a personal letterhead to safely delete instead. Needs the dev to name which endpoint ' +
          'the "add your own" flow actually calls (not documented in the KMAILAPI workbook) before this ' +
          'can be tested end to end; not worked around by deleting the shared default.',
      );
      expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
    });

    test('kmail-credentials: no live test (sensitive — returns account credentials)', () => {
      test.skip(
        true,
        "sensitive: sends a password and returns the account's real mail-send credentials. The " +
          "endpoint's own definition explicitly says NOT to drive it on live. Recorded as a deliberate " +
          'gap, not a workaround.',
      );
      expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
    });

    test('kmail-postbox-contacts: no live test (dev-confirmed not in use, not a gap)', () => {
      test.skip(
        true,
        'Dev-confirmed 2026-09-26: this route is not in use — intentionally unavailable on this build, ' +
          'not a deployment gap. Consistent with the plain Spring 404 "route not mapped" it returns. ' +
          'Not exercised, by design.',
      );
      expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
    });
  },
);
