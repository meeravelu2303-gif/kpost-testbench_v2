import { ENVIRONMENTAL_UI_OR_API_FAILURE } from '../../../src/bug-tracker/validity-gate';
import { expect, test } from '@fixtures';
import { statusCodeValidator } from '@validators/response/status-code.validator';
import { RESPONSES } from './support/fixtures';
import { fakeContext, fixtureEndpoint, verdict } from './support/validator-harness';

/** `response.status-code` gates every other primary check: when it FAILS, the rest are skipped. */
test.describe('validator unit · response.status-code', { tag: '@framework' }, () => {
  const expecting = (...statuses: number[]) => fixtureEndpoint({ expectedStatus: statuses });

  test.describe('known-good → PASSED', () => {
    test('the expected status passes', async () => {
      const result = await verdict(
        statusCodeValidator,
        fakeContext({ endpoint: expecting(200), primary: RESPONSES.clean }),
      );
      expect(result.status).toBe('PASSED');
      expect(result.actual).toBe(200);
      expect(result.expected).toEqual([200]);
    });

    test('any one of several accepted statuses passes', async () => {
      const result = await verdict(
        statusCodeValidator,
        fakeContext({ endpoint: expecting(200, 201), primary: RESPONSES.created }),
      );
      expect(result.status).toBe('PASSED');
      expect(result.message).toBe('status 201');
    });

    test('a 204 with no body passes when 204 is expected', async () => {
      const result = await verdict(
        statusCodeValidator,
        fakeContext({ endpoint: expecting(204), primary: RESPONSES.noContent }),
      );
      expect(result.status).toBe('PASSED');
    });
  });

  test.describe('known-bad → FAILED', () => {
    for (const [name, response] of [
      ['a 500 crash', RESPONSES.serverError],
      ['a 404', RESPONSES.notFound],
      ['a 201 where only 200 is documented', RESPONSES.created],
    ] as const) {
      test(`${name} fails and names both statuses`, async () => {
        const result = await verdict(
          statusCodeValidator,
          fakeContext({ endpoint: expecting(200), primary: response }),
        );
        expect(result.status).toBe('FAILED');
        expect(result.message).toBe(`expected 200, got ${response.status}`);
        expect(result.actual).toBe(response.status);
      });
    }

    test('the result carries the endpoint identity and CRITICAL severity a ticket needs', async () => {
      const context = fakeContext({ endpoint: expecting(200), primary: RESPONSES.serverError });
      const result = await verdict(statusCodeValidator, context);
      expect(result).toMatchObject({
        validatorName: 'response.status-code',
        category: 'RESPONSE',
        severity: 'CRITICAL',
        endpointId: 'fixture-echo',
        endpoint: 'POST /v2/fixture/echo',
        correlationId: context.primary.correlationId,
      });
    });
  });

  test.describe('no response', () => {
    // Deliberately FAILED, not SKIPPED: the validity gate rejects "no HTTP response", so both
    // wordings are pinned here to keep transport errors out of Bugzilla.
    test('a transport error fails with "no HTTP response", which the validity gate never files', async () => {
      const result = await verdict(
        statusCodeValidator,
        fakeContext({ endpoint: expecting(200), primary: RESPONSES.noResponse }),
      );
      expect(result.status).toBe('FAILED');
      expect(result.message).toBe('no HTTP response: read ECONNRESET');
      expect(result.actual).toBe(0);
      expect(result.message).toMatch(ENVIRONMENTAL_UI_OR_API_FAILURE);
    });

    test('status 0 is never in an expected list, so a dropped connection cannot pass', async () => {
      const result = await verdict(
        statusCodeValidator,
        fakeContext({ endpoint: expecting(0, 200), primary: RESPONSES.noResponse }),
      );
      expect(result.status).toBe('FAILED');
    });
  });
});
