import type { ContractSchema } from '@api/schema/contract-schema';
import { typesOnlySchema } from '@api/schema/sample-schema';
import { expect, test } from '@fixtures';
import { responseSchemaValidator } from '@validators/response/response-schema.validator';
import { RESPONSES, USER_SCHEMA_OPEN, USER_SCHEMA_STRICT } from './support/fixtures';
import { fakeContext, fixtureEndpoint, verdict } from './support/validator-harness';

/**
 * `response.schema` turns contract drift into a bug. A false FAILED files a schema defect against a
 * correct API; a false PASSED hides a broken payload. Both directions are pinned, along with what
 * the validator deliberately cannot see (an open, types-only contract).
 */
test.describe('validator unit · response.schema', { tag: '@framework' }, () => {
  const withSchema = (schema: ContractSchema = USER_SCHEMA_STRICT) =>
    fixtureEndpoint({ method: 'GET', responseSchema: schema });

  test.describe('known-good → PASSED', () => {
    test('a payload that matches the contract passes', async () => {
      const result = await verdict(
        responseSchemaValidator,
        fakeContext({ endpoint: withSchema(), primary: RESPONSES.clean }),
      );
      expect(result.status).toBe('PASSED');
      expect(result.actual).toBe('valid');
    });
  });

  test.describe('known-bad → FAILED', () => {
    test('type drift (an integer sent as a string) is caught at its path', async () => {
      const result = await verdict(
        responseSchemaValidator,
        fakeContext({ endpoint: withSchema(), primary: RESPONSES.typeDrift }),
      );
      expect(result.status).toBe('FAILED');
      expect(result.message).toContain('data.countryID: must be integer');
    });

    test('a missing required field is caught', async () => {
      const result = await verdict(
        responseSchemaValidator,
        fakeContext({ endpoint: withSchema(), primary: RESPONSES.missingField }),
      );
      expect(result.status).toBe('FAILED');
      expect(result.message).toMatch(/must have required property 'kpostID'/);
    });

    test('an undocumented field is caught when the contract is closed', async () => {
      const result = await verdict(
        responseSchemaValidator,
        fakeContext({ endpoint: withSchema(), primary: RESPONSES.unexpectedField }),
      );
      expect(result.status).toBe('FAILED');
      expect(result.message).toContain('must NOT have additional properties');
    });

    test('every violation is reported, not just the first', async () => {
      const result = await verdict(
        responseSchemaValidator,
        fakeContext({
          endpoint: withSchema(),
          primary: {
            status: 200,
            body: {
              status: 1,
              statusCode: '200',
              data: { firstName: 7, kpostID: 'x', countryID: 1 },
            },
          },
        }),
      );
      expect(result.status).toBe('FAILED');
      expect(result.message).toMatch(/^3 schema violation\(s\)/);
    });
  });

  test.describe('no response / nothing to judge → SKIPPED', () => {
    test('an endpoint with no response schema is skipped, not passed', async () => {
      const result = await verdict(
        responseSchemaValidator,
        fakeContext({ endpoint: fixtureEndpoint({ method: 'GET' }), primary: RESPONSES.clean }),
      );
      expect(result.status).toBe('SKIPPED');
      expect(result.message).toBe('endpoint defines no response schema');
    });

    test('no HTTP response is skipped', async () => {
      const result = await verdict(
        responseSchemaValidator,
        fakeContext({ endpoint: withSchema(), primary: RESPONSES.noResponse }),
      );
      expect(result.status).toBe('SKIPPED');
      expect(result.message).toBe('response has no content (HTTP 0)');
    });

    test('a 204 with no body is skipped', async () => {
      const result = await verdict(
        responseSchemaValidator,
        fakeContext({ endpoint: withSchema(), primary: RESPONSES.noContent }),
      );
      expect(result.status).toBe('SKIPPED');
      expect(result.message).toBe('response has no content (HTTP 204)');
    });

    test('a truncated JSON body is skipped with the parse error, never judged against the schema', async () => {
      const result = await verdict(
        responseSchemaValidator,
        fakeContext({ endpoint: withSchema(), primary: RESPONSES.malformedJson }),
      );
      expect(result.status).toBe('SKIPPED');
      expect(result.message).toMatch(/^response body is not valid JSON/);
    });

    test('check() itself refuses to judge a missing payload (defence behind appliesTo)', async () => {
      const result = await responseSchemaValidator.validate(
        fakeContext({ endpoint: withSchema(), primary: RESPONSES.noResponse }),
      );
      expect(result.status).toBe('SKIPPED');
    });
  });

  /*
   * What the validator CANNOT catch, by construction. These are characterisation tests: they pin
   * today's behaviour so a change to it is a decision, not an accident. See
   * docs/audits/test-suite-audit-2026-10-19.md, finding 3.
   */
  test.describe('blind spots of open contracts (pinned behaviour)', () => {
    test('an open contract accepts an undocumented field', async () => {
      const result = await verdict(
        responseSchemaValidator,
        fakeContext({ endpoint: withSchema(USER_SCHEMA_OPEN), primary: RESPONSES.unexpectedField }),
      );
      expect(result.status).toBe('PASSED');
    });

    test('a types-only schema built from a captured sample passes a payload with every field dropped', async () => {
      // `typesOnlySchema` is how the bench declares a captured shape (sample-schema.ts): every
      // field optional + nullable, so a hollowed-out `data: {}` still conforms.
      const result = await verdict(
        responseSchemaValidator,
        fakeContext({
          endpoint: withSchema(typesOnlySchema(RESPONSES.clean.body)),
          primary: RESPONSES.hollow,
        }),
      );
      expect(result.status).toBe('PASSED');
    });

    test('a types-only schema still catches type drift', async () => {
      const result = await responseSchemaValidator.validate(
        fakeContext({
          endpoint: fixtureEndpoint({
            method: 'GET',
            responseSchema: typesOnlySchema({ status: 'SUCCESS', statusCode: 200 }),
          }),
          primary: { status: 200, body: { status: 'SUCCESS', statusCode: 'two hundred' } },
        }),
      );
      expect(result.status).toBe('FAILED');
    });
  });
});
