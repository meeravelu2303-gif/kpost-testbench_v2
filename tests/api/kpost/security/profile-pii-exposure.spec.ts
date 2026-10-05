// Cross-account PII over-exposure via getUserProfileUsingKpostID. No live setup needed —
// productionSafe, read-only, already uses a second account's kpostID as its default body.
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * `getUserProfileUsingKpostID` (KDirectory "view full profile", FR-KD-005) is meant to let any
 * authenticated caller look up ANOTHER account's profile — that part is the intended feature. But
 * the response is not properly privacy-filtered: `UserProfileControllerV2.java:319` carries its own
 * unfinished TODO ("Need to validate based on privacy setting"), and the filter it actually calls
 * (`UserProfileDaoImpl.filterProfilePrivacySetting`, lines 1305-1331) only ever redacts
 * aboutYourself/experienceDetails/schoolDetails/collegeDetails/universityDetails/otherActivities/
 * mobileNumber — never dateOfBirth, aadhaarNumber, presentAddress, alternateMobileno, or
 * landLineNumber. Those five fields have no privacy control at all, for any account, confirmed live
 * 2026-10-05 (bug #1037) — the same field family already confirmed CRITICAL via a different endpoint
 * (globalSearch, bug #1005), reachable here through a second, independent code path.
 *
 * This is read-only and uses the endpoint's own already-`productionSafe` default body (a second real
 * QA account's kpostID) — no new live setup needed. The verdict is simply: does the response for an
 * account OTHER than the caller contain these fields with real, non-empty values.
 */
test.describe('KPost Security · Profile getUserProfileUsingKpostID PII over-exposure @api @kpost-api @security @profile', () => {
  test("fetching another account's profile must not return sensitive PII with no privacy control @api @security", async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'profile-user-profile-by-kpostid',
      { body: { kpostID: testData.personal3KpostId } },
      { label: 'security:profile-pii-exposure' },
    );

    expect(ex.status, 'the lookup succeeds').toBeLessThan(300);
    const text = ex.bodyText;
    const lower = text.toLowerCase();

    const sensitiveFields = [
      'aadhaarnumber',
      'dateofbirth',
      'presentaddress',
      'alternatemobileno',
      'landlinenumber',
    ];
    const foundFields = sensitiveFields.filter((f) => lower.includes(`"${f}"`));

    // A found field with a non-null, non-empty value is the real disclosure — not just the key
    // existing with a null placeholder, which this ORM includes unconditionally.
    const leakedWithValue = foundFields.filter((f) => {
      const re = new RegExp(`"${f}"\\s*:\\s*"[^"]+"`, 'i');
      return re.test(text);
    });

    if (leakedWithValue.length > 0) {
      const counts = leakedWithValue.map((field) => {
        const re = new RegExp(`"${field}"\\s*:\\s*"[^"]+"`, 'gi');
        return `${field}=${(text.match(re) ?? []).length}`;
      });
      endpoints.recordBusinessRuleViolation({
        endpointId: 'profile-user-profile-by-kpostid',
        ruleId: 'PII-profile-lookup-sensitive-field-disclosure',
        rule:
          'Fetching another account\'s profile must not return sensitive PII (Aadhaar number, date ' +
          'of birth, home address, alternate phone/landline) with no privacy control, regardless of ' +
          'the target account\'s own privacy settings.',
        expected: 'the response contains no sensitive PII fields with real values for a non-owner caller',
        actual: `fields with real values found in response, with occurrence counts: ${counts.join(', ')}`,
        request: { body: {} },
      });
    }

    expect
      .soft(
        leakedWithValue,
        `PII over-exposure: getUserProfileUsingKpostID response contains sensitive fields with real ` +
          `values: ${leakedWithValue.join(', ') || '(none)'} — viewing another account's profile must ` +
          `never return these`,
      )
      .toEqual([]);
  });
});
