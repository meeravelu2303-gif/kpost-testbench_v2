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
