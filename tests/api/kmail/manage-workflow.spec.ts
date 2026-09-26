/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { KMAIL_TYPE } from '@api/schemas/kpost-types';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { mailShape } from '@api/definitions/kmail/send.api';

/**
 * KMail **manage** writes not covered by the compose/draft/settings flows: status-clearing,
 * PDF conversion, the external-domain (OD) contact CRUD, other-domain attachment download, bulk
 * send, and a multipart draft. Gated `KMAIL_LIFECYCLE=true`, each write `allowLiveWrite`.
 *
 * OD-contact writes take a non-KPost email; the QA-identifier guard refuses a stranger's, so — per
 * the endpoint definition's own note — an address we own (`testData.kpostId`) stands in for the
 * external contact. `kmail-credentials` (sensitive: returns credentials) and `kmail-postbox-contacts`
 * (dev-confirmed 2026-09-26: not in use) are deliberately NOT exercised here; see the recorded-gap
 * tests at the end.
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

test.describe('KMail · manage workflow @api @kmail-api @kmail', () => {
  test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
  test.skip(
    process.env.KMAIL_LIFECYCLE !== 'true',
    'writes real KMail data; set KMAIL_LIFECYCLE=true',
  );

  test('clearStatusOfKmailsContacts and clearStatusOfAllKmailsContacts: `kmailStatusFlag` is required, but no value satisfies it', async ({
    endpoints,
  }) => {
    /*
     * Dev-confirmed 2026-09-26: this 500 crash "was fixed by using some custom annotations." Re-tested
     * live the same day — it is only PARTLY fixed. `selectedContact` alone (this endpoint's previous
     * default body) still 500s `{"errorCode":"clear mails exception occured",...}`; adding a
     * `kmailStatusFlag` field (any int 0-4) avoids the crash and gets a clean 400
     * `{"valueFor":"REPLY_NOT_SENT","message":"Parameter Invalid"}` instead. So the annotation fix
     * only covers the "field present" case — a genuinely missing `kmailStatusFlag` still reaches an
     * uncaught exception rather than a validation error. Filed automatically by the engine's own
     * flow-finding pipeline (a live 5xx auto-files/comments; no manual recordBusinessRuleViolation
     * needed) — this assertion is what keeps that finding open until the dev also validates the
     * field's ABSENCE, not just a bad value.
     *
     * Separately, and still open: no value of `kmailStatusFlag` (0-4, as an int) ever satisfies
     * "REPLY_NOT_SENT" — live-verified across a real send AND a real reply exchange between the two
     * test accounts (A sends to B, B replies to A, then A calls clear-status for B): identical error,
     * unchanged by the reply actually existing. This means either `kmailStatusFlag` is the wrong field
     * name entirely (its mere presence avoids the crash by luck, e.g. a null-check elsewhere), or the
     * real precondition for clearing status is unrelated to a reply happening at all. Not worked
     * around by guessing further — needs the dev to give the exact field name/type AND the account
     * state "REPLY_NOT_SENT" actually checks for.
     */
    expect
      .soft(
        await act(endpoints, 'kmail-clear-status', { selectedContact: B.username }, 'clear-status'),
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
        await act(endpoints, 'kmail-clear-all-status', { kmailStatusFlag: 0 }, 'clear-all-status'),
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
        expect.soft(pdf, 'convertMailAsPDF returns a status for a real kmailID').toBeLessThan(500);

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
    /*
     * The guard refuses a non-owned email, so testData.kpostId stands in for "an external contact"
     * — matching addOtherDomainContactApi's own definition note. `referenceName` ALSO matches the
     * guard's identifier pattern and needs a QA-owned allowlisted value, so the same owned address
     * is reused there too. `contactName` is a free-text display name (exempted in
     * qa-identifier-guard.ts 2026-09-26 — it was wrongly treated as a resource id, so the edit below
     * could previously only ever "change" the name back to the same owned address, a no-op that hid
     * the fact nothing was really being tested).
     *
     * There is no registered read endpoint that exposes an other-domain contact's stored name back
     * (`kmail-misc-contacts` returns bare email strings; `kmail-other-domain-mails` returns mail
     * records, not contact records) — live-verified 2026-09-26. So the edit's field-level effect is
     * NOT independently verifiable via this API; asserted as "accepted", which is the most this
     * bench can honestly claim, not worked around by inventing a check against data that isn't
     * exposed.
     */
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
    /*
     * Dev-confirmed 2026-09-26 (a working curl on a dev host): `postBulkMail` is NOT `postMail`'s
     * shape plus `toAddressList` — spreading `mailShape()` in (as this test previously did) is what
     * produced the bare 400 "Bad Request" with no detail. The real, minimal contract is just:
     * `{ toAddressList, kmailSubject, kmailContent, priority, kmailType: 13, attachmentUuid }`.
     * Live-verified against testkmail.kpostindia.com with this exact shape: 202 "Bulk PostMail Send
     * SuccessFully". (Also confirmed live: sending to the CALLER's own address 400s "Receiver Cannot
     * be same as sender" — sensible validation, not a defect — so the recipient list below is our
     * second QA account only, never the caller's own.)
     */
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
    /*
     * No cleanup step: the response carries no transaction/kmailID (just a plain success message),
     * so there is nothing here to delete by id — a real, permanent limitation of this endpoint's own
     * response shape, not something this bench can work around without inventing an id.
     */

    /*
     * kmail-bulk-status, unblocked by the same fix: it was recorded as blocked on "a real bulk-mail
     * fromAddress, which only a successful postBulkMail produces" — but `fromAddress` is just the
     * CALLER's own address (testData.kpostId), which needs no send to exist at all. Live-verified
     * 2026-09-26 right after a real bulk send: it correctly reports the just-sent mail's processing
     * state (`{"total":1,"status":"PROCESSING",...}`), not a stale/empty read.
     */
    const status = await endpoints.sendTo(
      'kmail-bulk-status',
      { pathParams: { fromAddress: testData.kpostId } },
      { label: 'kmail:bulk-status', auth: { principal: A }, allowLiveRead: true },
    );
    expect.soft(status.status, 'bulkMail/status reads back after a real bulk send').toBeLessThan(300);
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
    /*
     * The identifier-guard half of this gap is FIXED 2026-09-25: `referencekmailid`/`referencemails`
     * are now exempted as runtime-scoped KMail ids (same class as `kmailid`/`kallid` already were),
     * so a real mail's id can be used here instead of the guard refusing it outright.
     *
     * The request SHAPE is still Unknown/Requires Clarification, live-verified 2026-09-25: sending a
     * real kmailID from a mail just sent 400s "Bad Request" (a plain Spring deserialization failure,
     * no custom envelope) under every shape tried — `{referenceMails:[id]}` (number and string form),
     * `{referenceKmailID:id}`, `{kmailIDs:[id]}`, `{kmailIds:[id]}`, a raw `[id]` array body, and
     * `referenceMails`/`kmailID` as query params. Not worked around by guessing further; recorded
     * with a real id now available whenever the correct shape is confirmed.
     */
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
    /*
     * The HAPPY PATH (a real attachment uuid from a mail that actually has a file attached) is still
     * a recorded gap: `postMail` only accepts a JSON body with a pre-existing `attachmentUuid` — live-
     * verified 2026-09-25, it answers 415 "Unsupported Media Type" for a multipart request — and the
     * one documented multipart upload route, `draftMailMultiPart`, still 404s (see the test above).
     * There is no way to mint a real, uploaded attachment uuid for KMail yet, so the happy path is not
     * worked around with a fabricated one.
     *
     * What IS testable without a real upload: how each endpoint handles a well-formed but NONEXISTENT
     * uuid — and that surfaced a real, reproducible defect. Live-verified 2026-09-25 across 3 distinct
     * fake uuids: `downloadAttachment`/`downloadThumbnail` both answer 200 with an EMPTY body (should
     * be 404, not a silent empty "success"); `mediaStreaming` answers 500 every time (a crash on input
     * that will occur for real whenever a client holds a stale/deleted attachment reference) — filed
     * as **#604**, CRITICAL, KMail API.
     */
    // A genuine 5xx from an allowLiveRead-authorized call auto-files via the engine's own
    // flow-finding pipeline (verified: filed as #604) — no manual recordBusinessRuleViolation needed.
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
});
