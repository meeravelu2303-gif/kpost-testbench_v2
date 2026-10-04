// Directory-wide PII over-exposure via globalSearch. No live setup needed — productionSafe, read-only.
import { expect, test } from '@fixtures';

/**
 * KDirectory's `globalSearch` returns the raw `VW_KPOST_USER_DETAIL` entity for every matching user,
 * with no DTO/projection and no `@JsonIgnore` on any field — confirmed via the 2026-10-04 Contacts
 * ground-truth audit (`ContactsDirectoryDaoImpl.java:440-547`, `ContactsDirectoryControllerV2.java:
 * 965-968`). The entity includes `aadhaarNumber` (India's national ID, SSN-equivalent), `dateOfBirth`,
 * `presentAddress`, `pinCode`, `alternateMobileno`, `landLineNumber`, `email` — for ANY active user the
 * search matches, not just the caller's own contacts. The only predicates applied are `kpostID !=
 * caller` and `activeStatus = "yes"`; the entity's own `privacyStatus`/`privacySettings` fields exist
 * but are never used as a query filter here, even though the identical privacy-exclusion pattern
 * (`cb.notEqual(root.get("privacyStatus"), "1")`) is already used elsewhere in this same codebase
 * (`UserProfileDaoImpl.java:232,286`) — proving the gap is a missing filter, not a deliberate design.
 *
 * This is read-only and uses the bench's own regularly-run, `productionSafe` search request — no new
 * live setup needed. The verdict is simply: does the response body for a broad, generic search term
 * contain the Aadhaar/DOB/address fields for records that are not the caller's own?
 */
test.describe('KPost Security · Contacts globalSearch PII over-exposure @api @kpost-api @security @contacts', () => {
  test('a broad directory search must not return Aadhaar numbers or other sensitive PII for other users @api @security', async ({
    endpoints,
  }) => {
    const search = await endpoints.sendTo(
      'contacts-global-search',
      {
        body: {
          search: 'a',
          languageList: ['english'],
          userTypeList: ['personal'],
          countryList: ['india'],
        },
      },
      { label: 'security:contacts-globalsearch-pii', allowLiveRead: true },
    );

    expect(search.status, 'the search succeeds').toBeLessThan(300);
    const text = search.bodyText;
    const lower = text.toLowerCase();

    const sensitiveFields = [
      'aadhaarnumber',
      'datedbirth', // defensive alt-spelling guard; harmless if absent
      'dateofbirth',
      'presentaddress',
      'alternatemobileno',
      'landlinenumber',
    ];
    const foundFields = sensitiveFields.filter((f) => lower.includes(`"${f}"`));

    // A found field with a non-null, non-empty value is the real disclosure — not just the key
    // existing with a null placeholder, which some ORMs include unconditionally.
    const leakedWithValue = foundFields.filter((f) => {
      const re = new RegExp(`"${f}"\\s*:\\s*"[^"]+"`, 'i');
      return re.test(text);
    });

    if (leakedWithValue.length > 0) {
      // Count occurrences per field (not the values themselves) — useful triage signal without
      // dumping real PII into test output/reports every run.
      const counts = leakedWithValue.map((field) => {
        const re = new RegExp(`"${field}"\\s*:\\s*"[^"]+"`, 'gi');
        return `${field}=${(text.match(re) ?? []).length}`;
      });
      endpoints.recordBusinessRuleViolation({
        endpointId: 'contacts-global-search',
        ruleId: 'PII-globalsearch-sensitive-field-disclosure',
        rule:
          'A directory search must not return sensitive PII (Aadhaar number, date of birth, home ' +
          'address, alternate phone/landline) for users other than the caller, regardless of the ' +
          'search term matched.',
        expected: 'the response contains no sensitive PII fields with real values for other users',
        actual: `fields with real values found in response, with occurrence counts: ${counts.join(', ')}`,
        request: { body: { search: 'a' } },
      });
    }

    expect
      .soft(
        leakedWithValue,
        `PII over-exposure: globalSearch response contains sensitive fields with real values: ` +
          `${leakedWithValue.join(', ') || '(none)'} — a directory search must never return these`,
      )
      .toEqual([]);
  });
});
