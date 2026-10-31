import type { BugCandidate } from '../findings/bug-candidate';

/**
 * Human-judged false positives, rejected by the validity gate with their reason shown. Add one when
 * `report:filing` lists a non-bug under WILL CREATE; match as tightly as possible (fingerprint,
 * else endpoint + validator/field), since an over-broad entry hides real regressions.
 */
export interface KnownFalsePositive {
  /** Exact `[KP-]` fingerprint (with or without brackets); matched case-insensitively. */
  fingerprint?: string;
  /** Substring of the candidate's endpoint/title (e.g. '/v2/signupLogin/userLogin'). */
  endpoint?: string;
  /** Exact classification / validator name (e.g. 'security.injection'). */
  validator?: string;
  /** Substring that must appear in the finding's title/narrative (e.g. 'deviceType'). */
  field?: string;
  /** Text the finding's Actual must contain, so a really bad value on the field still files. */
  actualContains?: string;
  reason: string;
  judgedBy: string;
  /** ISO date the judgment was made. */
  date: string;
}

export const KNOWN_FALSE_POSITIVES: readonly KnownFalsePositive[] = [
  // Admin id-keyed reads answering 200 (empty) to a fuzzed id; reads only, a write still files.
  ...(
    ['/location/getLocation', '/rolePosting/getRolePostingByCompanyIdAndEmployeeId'] as const
  ).flatMap((endpoint) =>
    (['request.null-value', 'request.data-type'] as const).map((validator): KnownFalsePositive => ({
      endpoint,
      validator,
      reason:
        'A read answering 200 (empty result) to a null or wrongly-typed id is not a defect: judged INVALID by the developers for the same class on sibling reads (#331, #337, #355).',
      judgedBy: 'QA triage, following developer rulings #331/#337/#355',
      date: '2026-10-26',
    })),
  ),
  {
    endpoint: '/employeeDetails/getEmployeeDetails',
    validator: 'common.boolean',
    field: 'isExperienced',
    reason:
      'workExpObj.isExperienced is TEXT by design: the entity declares it a String (Admin_Module EmployeeDetailsEntity.java:117) and the Admin screen sends the dropdown label "Yes"/"No" (ManualEntry.js:1263). The generic is*-is-boolean check does not apply.',
    judgedBy: 'QA triage (run-ab440f10, source-confirmed)',
    date: '2026-10-23',
  },
  // Class matches on the judged value: these findings' counts change the fingerprint every run.
  {
    endpoint: '/v2/dashboard/homeDashboardMsgs',
    field: 'repeatedDate',
    actualContains: '12345',
    reason:
      'repeatedDate "12345" is the QA suite\'s own seeded value on scheduled calls, echoed back — not a product date-format defect. (Supersedes fingerprint KP-928DF1.)',
    judgedBy: 'QA triage (run-96b9c68c)',
    date: '2026-10-11',
  },
  {
    endpoint: '/v2/kall/todayKoolKall',
    field: 'repeatedDate',
    actualContains: '12345',
    reason:
      'Same seeded repeatedDate "12345" surfacing through the Kall list read — QA test data, not a product defect.',
    judgedBy: 'QA triage (run-23c39a35)',
    date: '2026-10-11',
  },
  {
    endpoint: '/dairySchedule/getTodaySchedules',
    field: 'preferredDate',
    actualContains: 'null',
    reason:
      'preferredDate null is a valid "not set" state for an optional date, not a malformed date value. (Supersedes fingerprint KP-8330EC.)',
    judgedBy: 'QA triage (run-96b9c68c)',
    date: '2026-10-11',
  },
  {
    endpoint: '/dairySchedule/getEventSelectedDate',
    field: 'preferredDate',
    actualContains: 'null',
    reason:
      'Same optional preferredDate returned as null on the selected-date read — valid not-set, not a defect.',
    judgedBy: 'QA triage (run-23c39a35)',
    date: '2026-10-11',
  },
  // Bench-fixture fault (empty kallID); delete once the fixture sends a valid one.
  {
    endpoint: '/v2/kall/kallDashboard',
    field: 'status must be SUCCESS',
    reason:
      "bench-fixture fault: the kallDashboard happy-path request sends an empty kallID and the server's FAILURE/400 is correct behaviour (#117 was closed rightly). Fix the fixture, then delete this entry.",
    judgedBy: 'QA triage (run-96b9c68c)',
    date: '2026-10-11',
  },
  {
    endpoint: '/common/getInstantReply',
    validator: 'common.id',
    reason:
      'getInstantReply customized replies use UUID ids by design; the "id must be a positive integer" check does not apply to this endpoint.',
    judgedBy: 'QA triage (run-42e9a1f1)',
    date: '2026-10-12',
  },
  // Bench-fixture fault (placeholder kmailID:0); delete once the fixture sends a real owned mail.
  {
    endpoint: '/readMail/sentAndInboxMailContent',
    actualContains: '403',
    reason:
      'bench-fixture fault: the request sends kmailID:0 (a non-existent / non-owned mail), so the 403 is correct. Fix the fixture to use a real owned kmailID, then delete this entry.',
    judgedBy: 'QA triage (run-42e9a1f1)',
    date: '2026-10-12',
  },
  {
    fingerprint: 'KP-39A349',
    endpoint: '/v2/signupLogin/userLogin',
    field: 'deviceType',
    reason:
      'SQL payload in deviceType is accepted (HTTP 200) but stored as inert device metadata — never executed, reflected, or leaked, and no 5xx. Acceptance alone is not injection. (Judgment call — confirm.)',
    judgedBy: 'QA triage (run-96b9c68c)',
    date: '2026-10-11',
  },
  {
    fingerprint: 'KP-4C1C8D',
    endpoint: '/v2/signupLogin/userLogin',
    field: 'deviceType',
    reason:
      'XSS payload in deviceType is accepted (HTTP 200) but stored as inert device metadata — not reflected unescaped anywhere, and no 5xx. (Judgment call — confirm; a separate stored-XSS check covers reflection.)',
    judgedBy: 'QA triage (run-96b9c68c)',
    date: '2026-10-11',
  },
  {
    endpoint: '/v2/kall/scheduledKall',
    field: 'must be object,null',
    reason:
      'scheduledKall correctly returns `data` as an ARRAY of scheduled calls; the bench response schema wrongly requires object|null. Bench-schema gap, not a server bug — fix the response schema. (Supersedes fingerprint KP-223254.)',
    judgedBy: 'QA live re-verify (run-420b3816)',
    date: '2026-10-12',
  },
  {
    fingerprint: 'KP-EBB10B',
    endpoint: '/v2/signupLogin/adminRegistration',
    reason:
      'adminRegistration returns 400 because the mobile/email OTP is not verified (or a required field is blank) — correct server behaviour. The "expected 200" is a test-flow limitation (OTP not completed), not a regression. Do NOT reopen #1262.',
    judgedBy: 'QA live re-verify (run-420b3816)',
    date: '2026-10-12',
  },
  {
    fingerprint: 'KP-EB57B9',
    endpoint: '/katchup/recallMessage',
    field: 'status must be SUCCESS',
    reason:
      'The request was a negative case (msgID:0, sender:"") and the server correctly returns FAILURE; the success-envelope check was misapplied to a failing input. Not a defect. Do NOT reopen #1268. (The real legacy-recall bug is the IDOR, KP-6F5E6B/#1267.)',
    judgedBy: 'QA live re-verify (run-420b3816)',
    date: '2026-10-12',
  },
  {
    fingerprint: 'KP-C760BC',
    reason:
      'Legacy POST /group/removeGroupMember/ (no /v2) returns 403 "Not Applicable"; it is a dead path the frontend never calls (it uses /v2/group/removeGroupMember/, which correctly returns a 400 with a proper envelope). Envelope-only nit on a dead path, ~zero user impact — not worth a ticket. Fingerprint-matched so the real /v2 removeGroupMember findings still file.',
    judgedBy: 'QA live re-verify (run-420b3816)',
    date: '2026-10-12',
  },
  // Triage of run-7ba221a3 (KPost API, 2026-10-30), each replayed live on 2026-10-31.
  {
    fingerprint: 'KP-F6FB49',
    endpoint: '/admin/createKpostIDAndDesignationSuggestion',
    reason:
      'The 200 to a foreign companyID returns nothing of that company: replayed as the 1034 admin, "Accounts Officer" (used only in 1034) gives "Accounts Officer1" with companyID 1034 AND 242, and "QA Tester" (5 users in 242, none in 1034) gives "QA Tester" with both. The server now scopes the lookup to the caller (#1027 fixed); the check only sees the 200.',
    judgedBy: 'QA live re-verify (run-7ba221a3, owner control)',
    date: '2026-10-31',
  },
  {
    fingerprint: 'KP-108498',
    endpoint: '/admin/displayNameSuggestion',
    reason:
      'displayNameSuggestion only abbreviates the companyName and designation the caller sends ("Neb Sol QA Tes"); it reads no company record, so a foreign companyID discloses nothing. Same answer for companyID 242 and 1034 on replay.',
    judgedBy: 'QA live re-verify (run-7ba221a3)',
    date: '2026-10-31',
  },
  {
    fingerprint: 'KP-DDD302',
    endpoint: '/v2/katchup/patchWorkForGroup',
    reason:
      'Admin-only repair job: KatchupControllerV2 refuses everyone but info@kpost.in with 403 (developer change 26-Sep-2026), and the definition declares 403. The valid-token check counted that role refusal as a rejected token; fixed in valid-token.validator.ts the same day.',
    judgedBy: 'QA triage (run-7ba221a3, source + live replay)',
    date: '2026-10-31',
  },
  {
    fingerprint: 'KP-A8C21C',
    endpoint: '/v2/profile/kmailPasswordPatchWork',
    reason:
      'Admin-only job: UserProfileControllerV2 allows only two named admin ids and answers 403 to everyone else (developer change 28-Sep-2026), as the definition declares. A role refusal, not a rejected token; the valid-token check is fixed.',
    judgedBy: 'QA triage (run-7ba221a3, source + live replay)',
    date: '2026-10-31',
  },
  {
    fingerprint: 'KP-87DB8E',
    endpoint: '/v2/signupLogin/signup',
    reason:
      'The firstName/lastName/dateOfBirth cases answer 409 because the fixture account already exists, which refuses the request before typing is looked at. The one real fault in it (countryCode → 500) is any unknown country code, number or text, and is filed separately with the right cause.',
    judgedBy: 'QA live re-verify (run-7ba221a3)',
    date: '2026-10-31',
  },
  // One root cause, one bug: any requestType it does not know answers 500, filed as KP-E9D179.
  ...(['KP-275ADF', 'KP-D95458'] as const).map((fingerprint): KnownFalsePositive => ({
    fingerprint,
    endpoint: '/v2/profile/getDesignationOrProfession',
    reason:
      'Same root cause as KP-E9D179: every requestType the endpoint does not recognise answers 500, a plain word ("nonsense") and an empty body included, so the script/SQL strings are not being interpreted. Filed once, under KP-E9D179.',
    judgedBy: 'QA live re-verify (run-7ba221a3)',
    date: '2026-10-31',
  })),
  {
    endpoint: '/readMail/draftMailContent',
    validator: 'request.data-type',
    field: 'draftKmailID',
    reason:
      'draftKmailID is a long (ReadMailRequestObject.java:53), so the "number instead of string" case sends the right type; the 500 is a draft id that does not exist. Judged INVALID by the developers as #791; KP-3721F7 on 2026-10-30 is the same finding.',
    judgedBy: 'QA triage, following developer ruling #791',
    date: '2026-10-31',
  },
  // UI chromium run-dfe2c798 (2026-10-31): two failures that never reached the behaviour they check.
  {
    fingerprint: 'KP-EF6767',
    actualContains: 'the 2nd QA account is in the conversation list',
    reason:
      'Not the avatar logout (#13288): the test could not find the conversation row because this build ids Recents rows "katchup-recent-<date>-<kpostID>". Bench selector fixed (support/katchup.ts conversationRow); a failure at the avatar step still files.',
    judgedBy: 'QA triage (run-dfe2c798, DOM read live)',
    date: '2026-10-31',
  },
  {
    fingerprint: 'KP-68A77F',
    actualContains: 'the save request must have fired',
    reason:
      'The rejected-save check never reached Save: this build names the menu item with its icon (" Save") and confirms in a page dialog, so the bench clicked nothing. Spec fixed the same day and passes alone (the app shows the error). A failure after the Save request fires still files.',
    judgedBy: 'QA triage (run-dfe2c798, re-run alone)',
    date: '2026-10-31',
  },
];

function norm(tag: string): string {
  return tag.replace(/^\[|\]$/g, '').toUpperCase();
}

/**
 * Why this candidate is a known false positive, or undefined. Every specified field must match; an
 * empty entry never matches.
 */
export function knownFalsePositiveReason(candidate: BugCandidate): string | undefined {
  const id = norm(candidate.id);
  const haystack =
    `${candidate.title ?? ''} ${candidate.narrative ?? ''} ${candidate.endpoint ?? ''}`.toLowerCase();
  const actual = String(candidate.actual ?? '').toLowerCase();
  for (const fp of KNOWN_FALSE_POSITIVES) {
    const keys = [fp.fingerprint, fp.endpoint, fp.validator, fp.field].filter(Boolean);
    if (!keys.length) continue;
    if (fp.fingerprint && norm(fp.fingerprint) !== id) continue;
    if (fp.endpoint && !haystack.includes(fp.endpoint.toLowerCase())) continue;
    if (fp.validator && candidate.classification !== fp.validator) continue;
    if (fp.field && !haystack.includes(fp.field.toLowerCase())) continue;
    if (fp.actualContains && !actual.includes(fp.actualContains.toLowerCase())) continue;
    return `known false positive (judged ${fp.date} by ${fp.judgedBy}): ${fp.reason}`;
  }
  return undefined;
}

/**
 * A check failure a closed Bugzilla ticket (INVALID/WONTFIX) ruled not a defect, reported as
 * SKIPPED with that ruling. Strict: every failing sub-check must be a judged field (with the judged
 * value, if set).
 */
export interface JudgedCheck {
  /** The Bugzilla ticket whose resolution is the ruling. */
  bugzilla: number;
  /** Substring of the endpoint path (definition path, e.g. '/common/getInstantReply/'). */
  endpoint: string;
  /** Exact validator name (e.g. 'common.id'). */
  validator: string;
  /** Each failing sub-check's name must end with one of these (e.g. 'personalData.emailId'). */
  fields?: readonly string[];
  /** When set, each failing sub-check's actual value must match it. */
  actualPattern?: RegExp;
  /** For a whole-check failure (no sub-checks): text the failure message must contain. */
  messageContains?: string;
  reason: string;
}

export const JUDGED_CHECKS: readonly JudgedCheck[] = [
  {
    bugzilla: 943,
    endpoint: '/common/msStatus/',
    validator: 'response.structure',
    messageContains: '"SUCCESS" is not valid JSON',
    reason:
      'WONTFIX (#936, #943): the service-status probe answers the bare word SUCCESS by design, not a JSON envelope',
  },
  {
    bugzilla: 830,
    endpoint: '/common/getInstantReply/',
    validator: 'common.id',
    fields: ['.id'],
    actualPattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    reason:
      'WONTFIX (2026-10-10): built-in instant replies use numeric ids and user-customised ones use UUIDs, by design — a UUID id here is not a defect',
  },
  {
    bugzilla: 320,
    endpoint: '/rolePosting/getSuspendOrTerminateEmployee',
    validator: 'response.status-code',
    messageContains: 'expected 200, got 400',
    reason:
      'INVALID (#320, adopting KP-63C403): an EMPTY suspended/terminated list is answered 400 "requestType is Empty or Invalid" — accepted by the team as "nobody listed"',
  },
];

/** The ruling covering this failed check, or undefined. `failed` = every FAILED sub-check. */
export function judgedCheckReason(
  path: string,
  validator: string,
  failed: readonly { name: string; actual?: unknown }[],
  message = '',
): string | undefined {
  for (const j of JUDGED_CHECKS) {
    if (j.validator !== validator || !path.includes(j.endpoint)) continue;
    const covered = j.messageContains
      ? message.includes(j.messageContains)
      : failed.length > 0 &&
        failed.every(
          (check) =>
            (j.fields ?? []).some((field) => check.name.endsWith(field)) &&
            (!j.actualPattern ||
              j.actualPattern.test(
                typeof check.actual === 'string'
                  ? check.actual
                  : (JSON.stringify(check.actual) ?? ''),
              )),
        );
    if (covered) return `judged not a defect in Bugzilla #${j.bugzilla} — ${j.reason}`;
  }
  return undefined;
}
