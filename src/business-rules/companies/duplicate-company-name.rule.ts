import { getPath } from '@utils/json';
import { expectBusinessError, type BusinessRule } from '../business-rule';

export const duplicateCompanyNameRule: BusinessRule = {
  id: 'duplicate-company-name',
  description: 'Company names are unique, case-insensitively (409 DUPLICATE_COMPANY)',
  severity: 'HIGH',
  dependsOn: ['response.status-code'],
  async check(context) {
    const name = String(getPath(context.request.body, 'name'));
    const duplicate = await context.send(
      await context.nextRequest({ body: { name: name.toUpperCase() } }),
      {
        label: 'business-rule.duplicate-company-name',
      },
    );
    return expectBusinessError(duplicate, 409, 'DUPLICATE_COMPANY');
  },
};
