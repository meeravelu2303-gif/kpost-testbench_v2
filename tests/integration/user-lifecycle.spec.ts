import { env } from '@config/env';
import { expect, test } from '@fixtures';

/**
 * Cross-endpoint workflow built from registered endpoints — no URLs or payloads duplicated.
 *
 * Every endpoint it drives (`create-company`, `create-user`, `get-user`, `delete-user`) is one of
 * the bench's own `mockFixture: true` definitions, which `EndpointExecutor.send` routes to
 * `env.API_BASE_URL` — the bundled mock — regardless of suite, TEST_ENV or configured module host.
 * So this flow cannot reach a real deployment, which is why it does NOT carry `@destructive`: that
 * tag exists to keep mutating tests away from a live target, and there is no live target to reach.
 * It had the tag, and the production `grepInvert(@destructive)` therefore removed the whole
 * `integration` project from every run — the test was invisible rather than safe.
 *
 * What it does need is the mock SERVER, which Playwright only starts when `MOCK_API=true`; without
 * it the request is refused at the socket. Hence the same gate `validation-engine.spec.ts` uses for
 * its own mock-only cases. Run it with `npm run bench -- --profile mock`.
 */
test.describe('User lifecycle', { tag: '@integration' }, () => {
  test.skip(!env.MOCK_API, 'drives the bench’s own mock fixtures; set MOCK_API=true');

  test('company → user → read → delete → not found', async ({ endpoints }) => {
    const company = await endpoints.call<{ id: string }>('create-company');
    const user = await endpoints.call<{ id: string; companyId: string }>('create-user', {
      body: { companyId: company.id },
    });
    expect(user.companyId).toBe(company.id);

    const fetched = await endpoints.sendTo(
      'get-user',
      { pathParams: { id: user.id } },
      { label: 'read' },
    );
    expect(fetched.status).toBe(200);

    const deleted = await endpoints.sendTo(
      'delete-user',
      { pathParams: { id: user.id } },
      { label: 'delete' },
    );
    expect(deleted.status).toBe(204);

    const gone = await endpoints.sendTo(
      'get-user',
      { pathParams: { id: user.id } },
      { label: 'read-deleted' },
    );
    expect(gone.status).toBe(404);
  });
});
