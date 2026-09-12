import type { ValidationContext } from '@engine/validation-context';
import type { Severity, ValidationOutcome } from '@engine/validation-result';
import { NamedRegistry } from '@utils/named-registry';
import type { DatabaseClient } from './database-client';

/** Endpoint-specific persistence check, referenced from `database: { validations: [...] }`. */
export interface DatabaseValidation {
  id: string;
  description: string;
  severity: Severity;
  check(context: ValidationContext, db: DatabaseClient): Promise<ValidationOutcome>;
}

export class DatabaseValidationRegistry extends NamedRegistry<DatabaseValidation> {
  constructor() {
    super('Database validation');
  }
}
