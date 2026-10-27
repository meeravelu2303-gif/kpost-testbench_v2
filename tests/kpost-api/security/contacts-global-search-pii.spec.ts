// Directory-wide PII over-exposure via globalSearch. No live setup needed — productionSafe, read-only.
import { expect, test } from '@fixtures';

/**
 * `globalSearch` returns the raw user-detail entity (Aadhaar, DOB, address, phones) for any matching
 * user, with no privacy filter. Verdict: does a broad search expose those fields for other users?
 */
test.describe(
  'KPost Security · Contacts globalSearch PII over-exposure @api @kpost-api @security @contacts',
  {
    tag: ['@api', '@platform', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
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

      // Only a non-empty value is a disclosure; a null placeholder key is not.
      const leakedWithValue = foundFields.filter((f) => {
        const re = new RegExp(`"${f}"\\s*:\\s*"[^"]+"`, 'i');
        return re.test(text);
      });

      if (leakedWithValue.length > 0) {
        // Count per field, never the values, so no real PII lands in reports.
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
          expected:
            'the response contains no sensitive PII fields with real values for other users',
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
  },
);
