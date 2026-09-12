import { expectBusinessError, type BusinessRule } from '../business-rule';

export const duplicateUserRule: BusinessRule = {
  id: 'duplicate-user',
  description: 'Creating a user with an existing e-mail is rejected (409 DUPLICATE_USER)',
  severity: 'HIGH',
  dependsOn: ['response.status-code'],
  async check(context) {
    // Re-send the exact payload that just succeeded.
    const duplicate = await context.send(context.request, {
      label: 'business-rule.duplicate-user',
    });
    return expectBusinessError(duplicate, 409, 'DUPLICATE_USER');
  },
};
