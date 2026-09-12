import { expect, test } from '@fixtures';

/** Cross-endpoint workflow built from registered endpoints — no URLs or payloads duplicated. */
test.describe('User lifecycle', { tag: ['@integration', '@destructive'] }, () => {
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
