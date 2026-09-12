import type { ValidationContext } from '@engine/validation-context';
import { fromChecks } from '@engine/validation-result';
import { getPath, isPlainObject } from '@utils/json';
import { dbAssert } from '../db-assertions';
import type { DatabaseValidation } from '../database-validation';
import { CompanyRepository } from '../repositories/company.repository';
import { UserRepository } from '../repositories/user.repository';

const pick = (source: unknown, keys: readonly string[]): Record<string, unknown> =>
  isPlainObject(source)
    ? Object.fromEntries(keys.filter((k) => k in source).map((k) => [k, source[k]]))
    : {};

const createdId = (context: ValidationContext): string => {
  const parsed = context.primary.json();
  return String(parsed.ok ? getPath(parsed.value, 'data.id') : '');
};
const pathId = (context: ValidationContext): string => String(context.request.pathParams?.id ?? '');

export const userCreatedValidation: DatabaseValidation = {
  id: 'user-created',
  description: 'Created user is persisted with request values, audit fields and a valid company FK',
  severity: 'HIGH',
  async check(context, db) {
    const record = await new UserRepository(db).findById(createdId(context), context.correlationId);
    const company = record
      ? await new CompanyRepository(db).findById(record.companyId, context.correlationId)
      : undefined;
    return fromChecks(
      [
        dbAssert.exists('user', record),
        ...dbAssert.fieldsMatch(
          record,
          pick(context.request.body, ['email', 'firstName', 'lastName', 'role', 'companyId']),
        ),
        ...dbAssert.auditFields(record, { createdBy: true }),
        dbAssert.notDeleted(record),
        dbAssert.foreignKey('users.companyId → companies.id', company),
      ],
      'database checks',
    );
  },
};

export const userUpdatedValidation: DatabaseValidation = {
  id: 'user-updated',
  description: 'Updated user row reflects the request and updatedAt advanced',
  severity: 'HIGH',
  async check(context, db) {
    const record = await new UserRepository(db).findById(pathId(context), context.correlationId);
    return fromChecks(
      [
        dbAssert.exists('user', record),
        ...dbAssert.fieldsMatch(
          record,
          pick(context.request.body, ['firstName', 'lastName', 'role']),
        ),
        dbAssert.updated(record),
      ],
      'database checks',
    );
  },
};

export const userDeletedValidation: DatabaseValidation = {
  id: 'user-deleted',
  description: 'Deleted user is soft-deleted (row kept, deletedAt set, inactive)',
  severity: 'HIGH',
  async check(context, db) {
    const record = await new UserRepository(db).findById(pathId(context), context.correlationId);
    return fromChecks(dbAssert.softDeleted(record), 'database checks');
  },
};
