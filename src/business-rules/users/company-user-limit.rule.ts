import { expectBusinessError, type BusinessRule } from '../business-rule';

/** Licence limit: a company with `maxUsers: 1` accepts exactly one user. */
export const companyUserLimitRule: BusinessRule = {
  id: 'company-user-limit',
  description: 'A company cannot exceed its licensed user limit (409 COMPANY_USER_LIMIT_REACHED)',
  severity: 'CRITICAL',
  async check(context) {
    const company = await context.call<{ id: string }>('create-company', { body: { maxUsers: 1 } });
    const inCompany = { body: { companyId: company.id } };
    await context.call('create-user', inCompany);
    const exceeding = await context.send(await context.nextRequest(inCompany), {
      label: 'business-rule.company-user-limit',
    });
    return expectBusinessError(exceeding, 409, 'COMPANY_USER_LIMIT_REACHED');
  },
};
