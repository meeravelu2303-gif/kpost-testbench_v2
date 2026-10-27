import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import { apiRegistry } from '@api/definitions/index';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';
import { getPath } from '@utils/json';
import { SMOKE_MAX_MS, type SmokeRead } from './smoke-checks';

/**
 * How an API smoke read is judged. A pass means the service answered, in time, with a SUCCESS
 * envelope and the data the screen needs, for the right account. The request is the endpoint's own
 * registered request (the payload the real frontend sends), never a hand-written one.
 */

const typeOf = (value: unknown): string =>
  Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;

/** A scalar as text for comparison; anything else (missing, object) as JSON, so it never matches. */
const asText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : (JSON.stringify(value) ?? 'undefined');

/** Send the endpoint's registered request as its default principal. */
async function send(endpoints: EndpointExecutor, read: SmokeRead): Promise<ApiResponseWrapper> {
  const endpoint = resolveEndpoint(apiRegistry.get(read.endpoint));
  const spec = await endpoints.buildRequest(endpoint);
  return endpoints.send(endpoint, spec, { label: `smoke:${read.endpoint}` });
}

export async function expectSmokeRead(endpoints: EndpointExecutor, read: SmokeRead): Promise<void> {
  const ex = await send(endpoints, read);
  const maxMs = read.maxMs ?? SMOKE_MAX_MS;
  test.info().annotations.push({
    type: 'observed',
    description: `${ex.request.method} ${ex.request.url} → HTTP ${ex.status} in ${ex.durationMs} ms`,
  });

  expect(ex.transportError, 'the server answered (no network error or timeout)').toBeUndefined();
  expect(ex.status, 'HTTP 200').toBe(200);
  expect(
    ex.durationMs,
    `answered within ${maxMs} ms (a hang guard, not a performance target)`,
  ).toBeLessThan(maxMs);

  if (read.plainText !== undefined) {
    expect(ex.bodyText.trim(), 'the plain-text answer').toBe(read.plainText);
    return;
  }

  const parsed = ex.json();
  expect(parsed.ok, `the answer is JSON${parsed.ok ? '' : ` (${parsed.reason})`}`).toBe(true);
  const body = parsed.ok ? parsed.value : undefined;

  // The envelope: KPost and KMail answer 200 even when the call failed, with the verdict inside.
  const status = getPath(body, 'status');
  if (status !== undefined) {
    expect(asText(status).toUpperCase(), 'the envelope says SUCCESS').toBe('SUCCESS');
  }
  const statusCode = getPath(body, 'statusCode');
  if (statusCode !== undefined) expect(Number(statusCode), 'the envelope statusCode').toBe(200);

  for (const [path, type] of Object.entries(read.fields ?? {})) {
    expect(typeOf(getPath(body, path)), `"${path}" is present as ${type}`).toBe(type);
  }
  if (read.ownerField) {
    expect(
      asText(getPath(body, read.ownerField)).toLowerCase(),
      `"${read.ownerField}" is the signed-in account (our own data, not someone else's)`,
    ).toBe(testData.kpostId.toLowerCase());
  }
}
