import { fromChecks } from '@engine/validation-result';
import { getPath, isPlainObject } from '@utils/json';
import { dbAssert } from '../db-assertions';
import type { DatabaseValidation } from '../database-validation';
import { CompanyRepository } from '../repositories/company.repository';

export const companyCreatedValidation: DatabaseValidation = {
  id: 'company-created',
  description: 'Created company is persisted with request values and audit fields',
  severity: 'HIGH',
  async check(context, db) {
    const parsed = context.primary.json();
    const id = String(parsed.ok ? getPath(parsed.value, 'data.id') : '');
    const record = await new CompanyRepository(db).findById(id, context.correlationId);
    const body = isPlainObject(context.request.body) ? context.request.body : {};
    return fromChecks(
      [
        dbAssert.exists('company', record),
        ...dbAssert.fieldsMatch(record, {
          name: body.name,
          contactEmail: body.contactEmail,
          maxUsers: body.maxUsers,
        }),
        ...dbAssert.auditFields(record, { createdBy: true }),
      ],
      'database checks',
    );
  },
};
