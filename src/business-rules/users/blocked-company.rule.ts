import { expectBusinessError, type BusinessRule } from '../business-rule';

export const blockedCompanyRule: BusinessRule = {
  id: 'blocked-company',
  description: 'Users cannot be created in a blocked company (422 COMPANY_BLOCKED)',
  severity: 'HIGH',
  async check(context) {
    const company = await context.call<{ id: string }>('create-company', {
      body: { status: 'BLOCKED' },
    });
    const attempt = await context.send(
      await context.nextRequest({ body: { companyId: company.id } }),
      {
        label: 'business-rule.blocked-company',
      },
    );
    return expectBusinessError(attempt, 422, 'COMPANY_BLOCKED');
  },
};
