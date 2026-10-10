import { body } from '@api/definitions/kpost/kpost-endpoint';
import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import { retarget, withPlaceholderPrimary } from '@api/sweep-target';
import { PRECONDITION_STATUS, resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/**
 * The write sweep sends each endpoint's valid request for real. These pin the two rules that keep it
 * from filing invalid bugs: the shared counterparty is swapped for a throwaway account, and a write
 * that needs a record the sweep lacks may answer with a client rejection (a 5xx or 401 still fails).
 */
test.describe('write sweep helpers @framework', () => {
  test('retarget swaps the account inside nested strings and leaves buffers alone', () => {
    const buffer = Buffer.from('x');
    const out = retarget(
      { contactID: 'V', list: ['V', 'keep'], nested: { text: '{"to":"V"}' }, n: 3, file: buffer },
      'V',
      'S',
    );
    expect(out.contactID).toBe('S');
    expect(out.list).toEqual(['S', 'keep']);
    expect(out.nested.text).toBe('{"to":"S"}');
    expect(out.n).toBe(3);
    expect(out.file, 'a buffer is the same object, untouched').toBe(buffer);
  });

  const write = (id: string, extra: Partial<EndpointDefinition> = {}): EndpointDefinition => ({
    id,
    method: 'POST',
    path: `/v2/test/${id}`,
    tags: ['test'],
    destructive: true,
    request: body(() => ({ id: 0 })),
    ...extra,
  });

  test('a placeholder-driven write accepts a client rejection but not a crash or a 401', () => {
    const status = resolveEndpoint(withPlaceholderPrimary(write('some-write'))).expectedStatus;
    for (const ok of [200, 400, 403, 404, 409, 422]) {
      expect(status, `${ok} is acceptable`).toContain(ok);
    }
    for (const bad of [401, 500, 502, 503])
      expect(status, `${bad} stays a defect`).not.toContain(bad);
    expect(status).toEqual(PRECONDITION_STATUS);
  });

  test('an endpoint that must succeed on its own keeps the strict default', () => {
    const strict = resolveEndpoint(withPlaceholderPrimary(write('group-create'))).expectedStatus;
    expect(strict, 'a 404 or 400 on the primary is a real finding here').not.toContain(404);
    expect(strict).not.toContain(400);
    expect(strict).not.toEqual(PRECONDITION_STATUS);
  });

  test('an explicit expectedStatus is never overridden', () => {
    const explicit = resolveEndpoint(
      withPlaceholderPrimary(write('other-write', { expectedStatus: [204] })),
    ).expectedStatus;
    expect(explicit).toEqual([204]);
  });
});
