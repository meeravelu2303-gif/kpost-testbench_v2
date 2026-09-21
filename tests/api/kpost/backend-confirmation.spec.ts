import type { Principal } from '@config/auth.config';
import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { slotPrincipals, type CleanupCoordinator } from '../../../src/test-data/index';

/**
 * Targeted confirmation of the backend bug candidates (owner-requested, 2026-09-21).
 *
 * ## What this is for, and what it must not do
 *
 * The full API run produced candidates. A candidate is not a defect: a 500 can equally mean the
 * bench sent something the product never sends, or that a precondition was never met. This spec
 * exists to settle that one question per candidate, by driving each endpoint with a **valid**
 * request under **satisfied preconditions** and recording exactly what came back.
 *
 * It must not manufacture failures. Every request here is the one the product itself would make, and
 * where a candidate turns out to succeed under a correct precondition, that is the finding — not a
 * bug.
 *
 * ## Safety
 *
 * Reads run as ordinary authenticated reads. The one write (`addOrRemoveAdminAccess`) needs a real
 * group, so it creates its own and registers it with the resource ledger before asserting. Every
 * call goes through `EndpointExecutor.send`, so the production guard, the SMS/OTP kill-switch and
 * the QA-identifier guard apply unchanged. Nothing here files anything.
 */

const [A, B] = slotPrincipals(2) as [Principal, Principal];

/** Status, body and content type of one exchange — the evidence a confirmation rests on. */
interface Probe {
  status: number;
  body: string;
  contentType: string | undefined;
}

function probeOf(exchange: {
  status: number;
  headers: Record<string, string>;
  json(): { ok: boolean; value?: unknown };
}): Probe {
  const parsed = exchange.json();
  return {
    status: exchange.status,
    body: parsed.ok ? JSON.stringify(parsed.value).slice(0, 400) : '(not JSON)',
    contentType: exchange.headers['content-type'],
  };
}

const line = (name: string, p: Probe): string =>
  `${name}\n  status ${String(p.status)} · ${p.contentType ?? 'no content-type'}\n  ${p.body}`;

/** The `data` object of a response. Module scope: data-shaping, not test flow. */
function dataObject(exchange: {
  json(): { ok: boolean; value?: unknown };
}): Record<string, unknown> | undefined {
  const parsed = exchange.json();
  if (!parsed.ok) return undefined;
  const data = (parsed.value as { data?: unknown }).data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
}

/**
 * The member ROW id `createUserGroup` issued for a given member.
 *
 * Module scope so the test body carries no data-shaping. This id is the whole point of the
 * `group-admin-access` confirmation: promotion needs the row id the product itself minted, and
 * sending a placeholder is what produced the 500 that reached the bug candidates.
 */
function memberRowIdFor(group: Record<string, unknown> | undefined, kpostID: string): unknown {
  const members = Array.isArray(group?.memberDetails)
    ? (group.memberDetails as Record<string, unknown>[])
    : [];
  return members.find((row) => row.kpostID === kpostID)?.id;
}

const memberEntry = (kpostID: string, isAdmin = false): Record<string, unknown> => ({
  createdBy: A.username,
  hasAdminAccess: isAdmin ? 'Y' : 'N',
  kpostID,
  name: 'QA Bench',
  memberDesignation: '',
  privacyStatus: 'Y',
  remarks: 'created',
});

test.describe('KPost · backend bug confirmation', { tag: '@kpost-api' }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(!env.GROUP_LIFECYCLE, 'targeted confirmation; set GROUP_LIFECYCLE=true');

  test('CD-BE-001 · getTotalCountByDate: valid vs malformed @api @confirmation', async ({
    endpoints,
  }: {
    endpoints: EndpointExecutor;
  }, testInfo) => {
    /*
     * The question: does the endpoint fault on a WELL-FORMED request, or only on the shape the bench
     * happens to send? A malformed body is the control — if it answers a clean 400 while a
     * well-formed one answers 500, routing and parsing work and the handler itself is at fault.
     */
    const valid = await endpoints.sendTo(
      'common-total-count-by-date',
      { body: { date: Date.now() } },
      { label: 'confirm:tcbd-valid-epoch' },
    );
    const isoDate = await endpoints.sendTo(
      'common-total-count-by-date',
      { body: { date: new Date().toISOString().slice(0, 10) } },
      { label: 'confirm:tcbd-valid-iso' },
    );
    const malformed = await endpoints.sendTo(
      'common-total-count-by-date',
      { body: [1, 2, 3] },
      { label: 'confirm:tcbd-malformed' },
    );

    await testInfo.attach('CD-BE-001', {
      body: [
        line('well-formed {date: <epoch>}', probeOf(valid)),
        line('well-formed {date: "YYYY-MM-DD"}', probeOf(isoDate)),
        line('malformed (array body) — the control', probeOf(malformed)),
      ].join('\n\n'),
      contentType: 'text/plain',
    });

    expect(
      malformed.status,
      'the control: a malformed body must get a client error, proving routing and parsing work',
    ).toBeGreaterThanOrEqual(400);
    expect(malformed.status, 'and the control must not itself be a server error').toBeLessThan(500);
    expect(
      valid.status,
      'a well-formed request must not fault. If this is 500 while the control is 400, the handler ' +
        'is at fault, not the request.',
    ).toBeLessThan(500);
  });

  test('group-admin-access · with the REAL member row id, not a placeholder @api @group @confirmation', async ({
    endpoints,
    resources,
  }: {
    endpoints: EndpointExecutor;
    resources: CleanupCoordinator;
  }, testInfo) => {
    /*
     * The hypothesis this test exists to settle.
     *
     * The lifecycle sends `ids: [0]` — a placeholder. But `createUserGroup` RETURNS a real row id per
     * member (`memberDetails[].id`, e.g. 45104), and the frontend has that id when it promotes
     * someone. So the 500 may be the product faulting on an id that does not exist rather than a
     * defect in promotion itself. Sending both settles it:
     *
     *   real id succeeds, placeholder 500s  → the bench payload was wrong; NOT a backend bug
     *   both 500                            → promotion is broken under valid preconditions
     */
    const created = await endpoints.sendTo(
      'group-create',
      {
        body: {
          activeStatus: 'Y',
          createdBy: A.username,
          groupPicturePath: null,
          groupCreateAccess: true,
          groupKpostName: `QA Confirm Admin ${Date.now()}`,
          isPrivateGroup: 'N',
          memberDetails: [memberEntry(B.username), memberEntry(A.username, true)],
        },
      },
      { label: 'confirm:group-create', auth: { principal: A }, allowLiveWrite: true },
    );
    const group = dataObject(created);
    const groupID = group?.groupID;
    const groupKpostID = group?.groupKpostID;
    expect(typeof groupID, `the group must exist first (status ${String(created.status)})`).toBe(
      'number',
    );

    resources.track({
      kind: 'katchup-group',
      id: String(groupID),
      describe: 'backend-confirmation group',
      cleanup: async () => {
        await endpoints.sendTo(
          'group-remove-member',
          { body: { memberKpostIdList: [B.username], groupID, groupKpostID } },
          {
            label: 'confirm:cleanup-members',
            auth: { principal: A },
            allowLiveWrite: true,
            phase: 'cleanup',
          },
        );
        const deleted = await endpoints.sendTo(
          'group-delete',
          { body: { groupID } },
          {
            label: 'confirm:cleanup-delete',
            auth: { principal: A },
            allowLiveWrite: true,
            phase: 'cleanup',
          },
        );
        return `deleteGroup (${String(deleted.status)})`;
      },
    });

    // The REAL member row id the create response issued for B — the non-admin member.
    const realId = memberRowIdFor(group, B.username);

    const withReal = await endpoints.sendTo(
      'group-admin-access',
      { body: { kpostIDs: [B.username], ids: [realId], groupID, hasAdminAccess: 'Y' } },
      { label: 'confirm:admin-access-real-id', auth: { principal: A }, allowLiveWrite: true },
    );
    const withPlaceholder = await endpoints.sendTo(
      'group-admin-access',
      { body: { kpostIDs: [B.username], ids: [0], groupID, hasAdminAccess: 'Y' } },
      { label: 'confirm:admin-access-placeholder', auth: { principal: A }, allowLiveWrite: true },
    );

    await testInfo.attach('group-admin-access', {
      body: [
        `member row id issued by createUserGroup: ${String(realId)}`,
        line('ids: [<real row id>]', probeOf(withReal)),
        line('ids: [0] — what the lifecycle sends', probeOf(withPlaceholder)),
      ].join('\n\n'),
      contentType: 'text/plain',
    });

    expect(
      withReal.status,
      'promotion with the row id the product itself issued must not fault. If this succeeds while ' +
        'ids:[0] faults, the 500 was our payload and this is NOT a backend bug.',
    ).toBeLessThan(500);
  });

  test('gap A · unhandled NullPointerException on a null field, control vs mutant @api @confirmation', async ({
    endpoints,
  }: {
    endpoints: EndpointExecutor;
  }, testInfo) => {
    /*
     * The independent confirmation for the two strongest gap-A candidates: a known-good request
     * against the SAME endpoint, immediately before the mutated one.
     *
     * The control is what makes this evidence rather than an observation. "A null produced a 500" on
     * its own could mean the endpoint is simply broken; the pair shows the endpoint works, and that
     * ONE null field is what breaks it. Both endpoints are READS — nothing is created, changed or
     * deleted here.
     *
     * The product's own response is the second, independent signal: it carries a Java
     * NullPointerException naming the field, which the validator never asserted and only the
     * application could have produced.
     */
    const probe = async (id: string, body: Record<string, unknown>, label: string) => {
      const ex = await endpoints.sendTo(id, { body }, { label: `confirm-a:${label}` });
      return probeOf(ex);
    };

    const countGood = await probe(
      'katchup-message-count',
      { receiver: testData.victimKpostId, groupFlag: 'false' },
      'count-control',
    );
    const countNull = await probe(
      'katchup-message-count',
      { receiver: testData.victimKpostId, groupFlag: null },
      'count-null-groupFlag',
    );
    const suggestGood = await probe(
      'signup-login-kpost-id-suggestions',
      { firstName: 'QA', lastName: 'Bench', mobileNumber: testData.mobileAbsent },
      'suggest-control',
    );
    const suggestNull = await probe(
      'signup-login-kpost-id-suggestions',
      { firstName: null, lastName: 'Bench', mobileNumber: testData.mobileAbsent },
      'suggest-null-firstName',
    );

    await testInfo.attach('gap-A-npe', {
      body: [
        line('messageCount — CONTROL, groupFlag "false"', countGood),
        line('messageCount — MUTANT, groupFlag null', countNull),
        line('kpostIDsuggestionList — CONTROL, firstName "QA"', suggestGood),
        line('kpostIDsuggestionList — MUTANT, firstName null', suggestNull),
      ].join(String.fromCharCode(10, 10)),
      contentType: 'text/plain',
    });

    expect(countGood.status, 'the control must succeed, or the pair proves nothing').toBeLessThan(
      400,
    );
    expect(suggestGood.status, 'the control must succeed').toBeLessThan(400);
    expect(
      countNull.status,
      `a null field must not crash the server. The control succeeded, so the endpoint works and the ` +
        `null is what breaks it. Response: ${countNull.body}`,
    ).toBeLessThan(500);
    expect(
      suggestNull.status,
      `a null field must not crash the server. Response: ${suggestNull.body}`,
    ).toBeLessThan(500);
  });

  test('gap A completion · the five contract-proven candidates, control vs mutant @api @confirmation', async ({
    endpoints,
  }: {
    endpoints: EndpointExecutor;
  }, testInfo) => {
    /*
     * The same standard that confirmed the first two: a known-good control on the SAME endpoint,
     * immediately before each mutant, so a 500 can be attributed to the mutated field rather than to
     * a broken endpoint.
     *
     * All three endpoints are `destructive: false, productionSafe: true` — presigned-URL generation
     * derives a signed URL from file metadata and writes nothing; the other two are existence and
     * suggestion lookups. Nothing here creates, changes or deletes state.
     *
     * Control values are the ones the endpoint definitions already use, so every identifier is
     * QA-owned and the identifier guard stays satisfied.
     */
    const probe = async (id: string, body: Record<string, unknown>, label: string) => {
      const ex = await endpoints.sendTo(id, { body }, { label: `confirm-a5:${label}` });
      return probeOf(ex);
    };
    const fileMeta = { extension: 'pdf', fileName: 'qa-bench.pdf', fileSize: '940' };
    const idExist = {
      kpostID: testData.kpostIdAbsent,
      firstName: 'QA',
      lastName: 'Bench',
      mobileNumber: testData.mobileAbsent,
    };
    const suggest = {
      kpostID: testData.signupKpostId,
      firstName: 'QA',
      lastName: 'Bench',
      mobileNumber: testData.signupMobile,
    };

    // ---- KP-25BD89 / KP-596D5D · aws/katchup/generate-presigned-url --------------------------
    const awsControl = await probe('aws-katchup-presigned', fileMeta, 'aws-control');
    const awsNullExt = await probe(
      'aws-katchup-presigned',
      { ...fileMeta, extension: null },
      'aws-null-extension',
    );
    const awsNullName = await probe(
      'aws-katchup-presigned',
      { ...fileMeta, fileName: null },
      'aws-null-fileName',
    );
    const awsEmpty = await probe('aws-katchup-presigned', {}, 'aws-empty-body');

    // ---- KP-8CA830 / KP-FE86A2 · signupLogin/kpostIdExist -------------------------------------
    const idControl = await probe('signup-login-kpost-id-exist', idExist, 'idexist-control');
    const idNullMobile = await probe(
      'signup-login-kpost-id-exist',
      { ...idExist, mobileNumber: null },
      'idexist-null-mobile',
    );
    const idNullKpost = await probe(
      'signup-login-kpost-id-exist',
      { ...idExist, kpostID: null },
      'idexist-null-kpostID',
    );
    const idEmpty = await probe('signup-login-kpost-id-exist', {}, 'idexist-empty-body');

    // ---- KP-8B109B · signupLogin/kpostIDsuggestionList ----------------------------------------
    const sugControl = await probe('signup-login-kpost-id-suggestions', suggest, 'suggest-control');
    const sugEmpty = await probe('signup-login-kpost-id-suggestions', {}, 'suggest-empty-body');

    await testInfo.attach('gap-A-completion', {
      body: [
        line('AWS presigned — CONTROL {extension,fileName,fileSize}', awsControl),
        line('AWS presigned — MUTANT extension: null  [KP-25BD89]', awsNullExt),
        line('AWS presigned — MUTANT fileName: null   [KP-25BD89]', awsNullName),
        line('AWS presigned — MUTANT empty body {}    [KP-596D5D]', awsEmpty),
        line('kpostIdExist — CONTROL', idControl),
        line('kpostIdExist — MUTANT mobileNumber: null [KP-8CA830]', idNullMobile),
        line('kpostIdExist — MUTANT kpostID: null      [KP-8CA830]', idNullKpost),
        line('kpostIdExist — MUTANT empty body {}      [KP-FE86A2]', idEmpty),
        line('kpostIDsuggestionList — CONTROL', sugControl),
        line('kpostIDsuggestionList — MUTANT empty body {} [KP-8B109B]', sugEmpty),
      ].join(String.fromCharCode(10, 10)),
      contentType: 'text/plain',
    });

    // The controls must succeed, or none of the pairs below mean anything.
    expect(awsControl.status, 'AWS presigned control must succeed').toBeLessThan(400);
    expect(idControl.status, 'kpostIdExist control must succeed').toBeLessThan(400);
    expect(sugControl.status, 'kpostIDsuggestionList control must succeed').toBeLessThan(400);

    // Each mutant: a bad input must not crash the server.
    const mutants: [string, Probe][] = [
      ['aws extension: null', awsNullExt],
      ['aws fileName: null', awsNullName],
      ['aws empty body', awsEmpty],
      ['kpostIdExist mobileNumber: null', idNullMobile],
      ['kpostIdExist kpostID: null', idNullKpost],
      ['kpostIdExist empty body', idEmpty],
      ['kpostIDsuggestionList empty body', sugEmpty],
    ];
    for (const [name, p] of mutants) {
      expect
        .soft(
          p.status,
          `${name}: the control succeeded, so the endpoint works — a bad input must not produce a server error. Response: ${p.body}`,
        )
        .toBeLessThan(500);
    }
  });

  test('read candidates · valid requests, recorded verbatim @api @confirmation', async ({
    endpoints,
  }: {
    endpoints: EndpointExecutor;
  }, testInfo) => {
    /*
     * Four reads, each with the payload the product sends. `globalSearch` gets TWO queries — one
     * that must match a real directory entry (our own QA account's first name) and one that cannot
     * match anything. That pair is what distinguishes "the endpoint is broken" from "a not-found
     * result is returned as 500", which are different defects with different fixes.
     */
    const matching = await endpoints.sendTo(
      'contacts-global-search',
      {
        body: {
          search: 'Abhinu',
          userType: 'PERSONAL',
          pincode: '',
          state: '',
          city: '',
          country: '',
        },
      },
      { label: 'confirm:global-search-matching' },
    );
    const noMatch = await endpoints.sendTo(
      'contacts-global-search',
      {
        body: {
          search: 'zzzznosuchperson',
          userType: 'PERSONAL',
          pincode: '',
          state: '',
          city: '',
          country: '',
        },
      },
      { label: 'confirm:global-search-no-match' },
    );
    /*
     * globalSearch with the payload the WORKBOOK documents — a different shape entirely from the
     * one the bench definition sends. The documented request is
     * {search, languageList[], userTypeList[], countryList[]}; the definition sends
     * {search, userType, pincode, state, city, country}. If the documented shape succeeds, the 500
     * was our payload and CD-BE-008 is not a product defect.
     */
    const documentedShape = await endpoints.sendTo(
      'contacts-global-search',
      {
        body: {
          search: 'Abhinu',
          languageList: ['english'],
          userTypeList: ['personal'],
          countryList: ['india'],
        },
      },
      { label: 'confirm:global-search-documented-shape' },
    );
    const documentedNoMatch = await endpoints.sendTo(
      'contacts-global-search',
      {
        body: {
          search: 'zzzznosuchperson',
          languageList: ['english'],
          userTypeList: ['personal'],
          countryList: ['india'],
        },
      },
      { label: 'confirm:global-search-documented-no-match' },
    );

    const searchDetails = await endpoints.sendTo(
      'contacts-search-details',
      { body: { requestType: 'areaName', country: 'INDIA', province: '', state: '', city: '' } },
      { label: 'confirm:search-details' },
    );
    const repeatKall = await endpoints.sendTo(
      'kall-fetch-scheduled-repeat',
      { body: { scheduledStartTime: '2024-06-14' } },
      { label: 'confirm:fetch-scheduled-repeat' },
    );
    const loginHistory = await endpoints.sendTo(
      'signup-login-login-history',
      { body: { kpostID: testData.kpostId } },
      { label: 'confirm:login-history' },
    );
    const share = await endpoints.sendTo(
      'profile-share-user-details',
      { body: { kpostID: testData.kpostId } },
      // A `data` write on our OWN profile, so it needs the same per-call authorisation the profile
      // lifecycle uses. Without it the production guard refuses the call, which is the guard working.
      { label: 'confirm:share-user-details', allowLiveWrite: true },
    );

    /*
     * The INDEPENDENT read-back for shareUserDetails. Its 500 says "Unable to retrieve shared user
     * profile" for our OWN kpostID — the account we are authenticated as. If a different endpoint
     * retrieves that same profile, then the account is retrievable and the message is false; if it
     * also fails, the fault is shared and this is not a shareUserDetails defect.
     */
    const profileLookup = await endpoints.sendTo(
      'profile-fetch-user-details',
      { body: { kpostID: testData.kpostId } },
      { label: 'confirm:profile-read-back' },
    );

    await testInfo.attach('read-candidates', {
      body: [
        line('globalSearch — a term that MUST match (own QA account)', probeOf(matching)),
        line('globalSearch — a term that cannot match', probeOf(noMatch)),
        line('globalSearch — DOCUMENTED payload, matching term', probeOf(documentedShape)),
        line('globalSearch — DOCUMENTED payload, non-matching term', probeOf(documentedNoMatch)),
        line('getSearchDetails — documented cascade payload', probeOf(searchDetails)),
        line('fetchScheduledRepeatKall — own schedules', probeOf(repeatKall)),
        line('getLoginHistory — own account, authenticated', probeOf(loginHistory)),
        line('shareUserDetails — own kpostID', probeOf(share)),
        line('INDEPENDENT: fetchUserDetails for the SAME kpostID', probeOf(profileLookup)),
      ].join('\n\n'),
      contentType: 'text/plain',
    });

    /*
     * One assertion only, on the clearest contract claim: a read that finds data must succeed. The
     * rest are RECORDED rather than asserted — this spec exists to gather evidence for a human
     * decision, and turning every observation into a failing assertion would prejudge exactly the
     * question the confirmation is meant to answer.
     */
    expect(
      matching.status,
      'a directory search for a name that exists must not fault',
    ).toBeLessThan(500);
  });
});
