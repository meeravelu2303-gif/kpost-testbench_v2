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
 * (404 on this test build) are deliberately NOT exercised here; see the recorded-gap tests at the end.
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

  test('clearStatusOfKmailsContacts and clearStatusOfAllKmailsContacts: exact request shape is Unknown/Requires Clarification', async ({
    endpoints,
  }) => {
    /*
     * Live-verified 2026-09-24: both consistently answer 400 `{"valueFor":"REPLY_NOT_SENT",
     * "message":"Parameter Invalid"}` regardless of whether a `kmailStatusFlag` (0-3) is added to
     * the body — the endpoint definition's own default body (`{selectedContact}` / no body at all)
     * is not what the backend expects, and "REPLY_NOT_SENT" suggests a required parameter this
     * bench has not identified. Not worked around by guessing further; asserted as "no server
     * error" only, which is genuinely all that's confirmed right now.
     */
    expect
      .soft(
        await act(endpoints, 'kmail-clear-status', { selectedContact: B.username }, 'clear-status'),
        'clearStatusOfKmailsContacts returns a status (exact required shape: Unknown/Requires Clarification)',
      )
      .toBeLessThan(500);
    expect
      .soft(
        await act(endpoints, 'kmail-clear-all-status', undefined, 'clear-all-status'),
        'clearStatusOfAllKmailsContacts returns a status (exact required shape: Unknown/Requires Clarification)',
      )
      .toBeLessThan(500);
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
     * — matching addOtherDomainContactApi's own definition note. contactName/referenceName ALSO
     * match the guard's identifier pattern (both contain "contact"/"name"-adjacent substrings it
     * treats broadly) and need a QA-owned allowlisted STRING value, not an arbitrary label — no
     * free-text QA name is configured, so the same owned address is reused there too.
     */
    const contactEmailID = testData.kpostId;

    const added = await act(
      endpoints,
      'kmail-add-od-contact',
      { contactEmailID, contactName: testData.kpostId, referenceName: testData.kpostId },
      'od-add',
    );
    expect.soft(added, 'addOtherDomainContacts is accepted').toBeLessThan(300);

    const edited = await act(
      endpoints,
      'kmail-edit-od-contact',
      { contactEmailID, contactName: testData.kpostId },
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

  test('postBulkMail: exact required shape is Unknown/Requires Clarification', async ({
    endpoints,
  }) => {
    /*
     * Live-verified 2026-09-24: a plain Spring 400 with no detail message, using the endpoint
     * definition's own default body shape (mailShape + toAddressList). Not enough information to
     * determine what the backend actually wants beyond that — not worked around by guessing further.
     */
    const bulk = await endpoints.sendTo(
      'kmail-post-bulk',
      {
        body: {
          ...mailShape({ kmailType: KMAIL_TYPE.bulkmail, kmailSubject: `QA Bulk ${Date.now()}` }),
          toAddressList: [B.username],
        },
      },
      { label: 'kmail:post-bulk', auth: { principal: A }, allowLiveWrite: true },
    );
    expect
      .soft(
        bulk.status,
        'postBulkMail returns a status (exact required shape: Unknown/Requires Clarification)',
      )
      .toBeLessThan(500);
    if (bulk.status < 300) {
      const parsed = bulk.json();
      const value = (parsed.ok ? parsed.value : {}) as { data?: unknown };
      const data = Array.isArray(value.data)
        ? (value.data[0] as Record<string, unknown>)
        : (value.data as Record<string, unknown> | undefined);
      const txns = data?.kmailTransactionList;
      const transactionIDs = Array.isArray(txns)
        ? (txns as Array<Record<string, unknown>>)
            .map((t) => t.transactionID ?? t.id)
            .filter((v): v is number => typeof v === 'number')
        : [];
      await endpoints
        .sendTo(
          'kmail-delete',
          { body: { groupFlag: false, transactionIDs } },
          { label: 'kmail:post-bulk-cleanup', auth: { principal: A }, allowLiveWrite: true },
        )
        .catch(() => undefined);
    }
  });

  test('draftMailMultiPart: no live business-rule test (recorded gap, not a workaround)', () => {
    test.skip(
      true,
      'testkmail answers a plain Spring 404 "Not Found" for POST /draft/draftMailMultiPart ' +
        "(live-verified 2026-09-24, using the endpoint definition's own multipart shape) — the " +
        'route is not deployed on this test build, the same pattern as kmail-postbox-contacts and ' +
        'kos-list-documents. Needs the dev to confirm whether the route ships on this build.',
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

  test("kmail-bulk-status: no live test (blocked by postBulkMail's Unknown/Requires Clarification shape)", () => {
    test.skip(
      true,
      'needs a real bulk-mail fromAddress, which only a successful postBulkMail produces — and ' +
        'postBulkMail itself currently 400s with no diagnosable detail (see the postBulkMail test ' +
        'above). Blocked on that being resolved first, not an independent gap.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });

  test('kmail-delete-letterhead: no live test (ownership of the only available letterhead is Unknown/Requires Clarification)', () => {
    test.skip(
      true,
      'getAllLetterHead lists exactly ONE letterhead (id "1") on this account, and whether it is a ' +
        'personal letterhead (safe to delete and re-create) or a shared system template (deleting it ' +
        'would remove it for every account) has not been confirmed. Re-checked 2026-09-25: ' +
        'getLetterHead marks it `"default":"Y"` and its assets sit at a generic S3 path ' +
        '(letterHead/LHH2.png, LHF2.png) — evidence pointing toward a shared system default, not ' +
        'something this account personally uploaded, which only strengthens the original concern. ' +
        'No registered endpoint creates a NEW letterhead to safely delete instead (only ' +
        'get-all/get-current/get-template/set-active-by-id/delete-by-id are registered). Deleting the ' +
        'only one on a guess risks destroying shared state — recorded pending the dev confirming the ' +
        'letterhead ownership model, not worked around by deleting it anyway.',
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

  test('kmail-postbox-contacts: no live test (recorded gap, not a workaround)', () => {
    test.skip(
      true,
      'returns Spring 404 "route not mapped" on this test build (see the endpoint definition\'s own ' +
        'note). Not run standalone (a 404 there reads as a false CRITICAL); needs the dev to confirm ' +
        'whether the route ships on this build before a business-rule test can be written.',
    );
    expect(true, 'placeholder — this test body never runs past test.skip above').toBe(true);
  });
});
