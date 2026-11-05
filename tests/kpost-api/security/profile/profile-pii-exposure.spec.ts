// Cross-account PII over-exposure via getUserProfileUsingKpostID. Read-only, no live setup.
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * Viewing another account's profile (FR-KD-005) is intended, but DOB, Aadhaar, address and phones
 * are never privacy-filtered (known defect #1037). Verdict: are they returned non-empty?
 */
test.describe(
  'KPost Security · Profile getUserProfileUsingKpostID PII over-exposure @api @kpost-api @security @profile',
  {
    tag: ['@api', '@platform', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
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

      // Only a non-empty value is a disclosure; a null placeholder key is not.
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
            "Fetching another account's profile must not return sensitive PII (Aadhaar number, date " +
            'of birth, home address, alternate phone/landline) with no privacy control, regardless of ' +
            "the target account's own privacy settings.",
          expected:
            'the response contains no sensitive PII fields with real values for a non-owner caller',
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
  },
);
