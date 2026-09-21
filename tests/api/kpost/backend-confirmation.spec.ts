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
