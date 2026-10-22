import type { BugCandidate } from './bug-candidate';

/**
 * Human-judged false positives: findings the validators correctly produced but that a QA reviewer
 * has decided are NOT product defects, for a reason no automated gate can infer from the record
 * alone (e.g. "that value is our own seeded test data", or "that field is inert device metadata").
 *
 * This is the one place such judgments live, so they are auditable and survive across runs. A
 * candidate matching an entry is REJECTED by the validity gate (never filed), and the rejection is
 * reported with the reason below — the gate's rule is that every suppression is visible, never silent.
 *
 * ## How to add one (the review-checkpoint flow)
 *
 * When `npm run report:filing` shows a finding under WILL CREATE that you judge is not a real bug,
 * add an entry here instead of filing-and-resolving-INVALID in Bugzilla (which litters the tracker).
 * Match as narrowly as the judgment allows:
 *   - `fingerprint` — the exact `[KP-xxxxxx]` id (most precise; use this unless the fingerprint drifts).
 *   - `endpoint` + `validator` (+ optional `field`) — a class match, when the same judgment applies to
 *     every field/variant of one (endpoint, validator) and the fingerprint changes run-to-run.
 * Always give a `reason`, `judgedBy` and `date`. Keep the match tight: an over-broad entry hides real
 * regressions. These are judgments, not permanent truths — delete an entry the moment it stops holding.
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
  /**
   * Substring that must appear in the finding's ACTUAL evidence (e.g. the seeded value '12345').
   * Anchors a class match to the judged value, so a future genuinely-bad value still files.
   */
  actualContains?: string;
  reason: string;
  judgedBy: string;
  /** ISO date the judgment was made. */
  date: string;
}

/**
 * Seeded from the run-96b9c68c triage (2026-10-11). The two `security.*` "accepted (HTTP 200)" entries
 * are a genuine judgment call (userLogin stores deviceType as inert metadata, never executing or
 * reflecting it) — confirm them before relying on the suppression.
 */
export const KNOWN_FALSE_POSITIVES: readonly KnownFalsePositive[] = [
  /*
   * The two date judgments below are CLASS matches (endpoint + field + the judged value), not
   * fingerprints: the finding's count ("21/625" → "42/1295") changes every run, which mints a new
   * fingerprint and let the same false positive back in on run-23c39a35 (as KP-56E4B1/KP-CB27D6/
   * KP-61D743/KP-B95D16). `actualContains` anchors each to the judged value, so a genuinely bad
   * date on the same field still files.
   */
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
  /*
   * NOT a product bug and NOT a reopen: the bench's kallDashboard happy-path fixture sends an EMPTY
   * kallID, and the server correctly rejects it with FAILURE/400 (verified by live replay,
   * run-96b9c68c triage). Without this entry the gate tries to REOPEN resolved #117 every run.
   * Remove this entry once the fixture sends a valid kallID.
   */
  {
    endpoint: '/v2/kall/kallDashboard',
    field: 'status must be SUCCESS',
    reason:
      "bench-fixture fault: the kallDashboard happy-path request sends an empty kallID and the server's FAILURE/400 is correct behaviour (#117 was closed rightly). Fix the fixture, then delete this entry.",
    judgedBy: 'QA triage (run-96b9c68c)',
    date: '2026-10-11',
  },
  /*
   * KMail getInstantReply: the "id must be a positive integer" check is wrong for THIS endpoint —
   * its default replies use numeric ids ("1","2") but CUSTOMIZED replies legitimately use UUIDs
   * (e.g. cb0b8d19-7de7-...). So a UUID id is correct data, not a defect. Class match on the
   * endpoint + validator so a genuinely bad id on a different endpoint still files. (run-42e9a1f1,
   * was KP-16FB8E.)
   */
  {
    endpoint: '/common/getInstantReply',
    validator: 'common.id',
    reason:
      'getInstantReply customized replies use UUID ids by design; the "id must be a positive integer" check does not apply to this endpoint.',
    judgedBy: 'QA triage (run-42e9a1f1)',
    date: '2026-10-12',
  },
  /*
   * KMail sentAndInboxMailContent 403: the bench sends a PLACEHOLDER kmailID:0 (a mail that does not
   * exist / is not the caller's), so a 403 is correct — it is a bench-fixture gap, not a defect.
   * Fix the fixture to send a real owned kmailID, then DELETE this entry (a 403 on a real owned mail
   * would be a genuine bug). (run-42e9a1f1, was KP-6CDA7E / KP-6B74E1.)
   */
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
  /*
   * Live re-verification of run-420b3816's would-file/reopen plan (2026-10-12). Each was replayed on
   * testingapi and judged NOT a product defect — see the per-entry reason. (The 4 genuine findings
   * from the same run — KP-06F947, KP-86FC80, KP-E667CA, and the #1267 reopen — were filed.)
   */
  {
    // Class match (the "1 schema violation" count is stable, but keep it endpoint+field anchored).
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
];

function norm(tag: string): string {
  return tag.replace(/^\[|\]$/g, '').toUpperCase();
}

/**
 * The reason this candidate is a known, human-judged false positive — or undefined when none matches.
 * An entry matches only when every field it specifies matches; an entry with no match fields never
 * matches (so an empty/typo entry cannot suppress everything).
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
 * Sanity-side judgments: an engine check that FAILS exactly the way a person already ruled "not a
 * defect" in Bugzilla (INVALID / WONTFIX) is reported as SKIPPED with that ruling, not as a failure, so
 * a sanity run is not red forever on findings nobody will fix. Separate from `KNOWN_FALSE_POSITIVES`
 * (which only stops filing) on purpose: each entry here is backed by a closed Bugzilla ticket, and the
 * match is strict — EVERY failing sub-check must be a judged field (and carry the judged value, where the
 * ruling depended on it). Any other failing field, or the same field with a different value, still fails.
 *
 * Not here on purpose: a ruling that the CHECK itself was wrong is fixed in the validator instead
 * (#210/#665 `emailId` → common.id, #630 empty optional URL → common.url), and rulings about the
 * environment rather than the behaviour (e.g. #480, "the endpoint
 * is unavailable on the test env") — a route that never answers stays a sanity failure.
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
  /**
   * For a check that fails as a whole (no field-level sub-checks, e.g. `response.structure`): the
   * failure message must contain this exact text — the symptom the ruling was about.
   */
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
];

/**
 * The Bugzilla ruling that covers this failed check, or undefined when it is not (fully) judged.
 * `failed` must be every FAILED sub-check of the result, not the truncated message list.
 */
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
