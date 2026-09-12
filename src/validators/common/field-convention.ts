import type { ValidationContext } from '@engine/validation-context';
import type { Severity } from '@engine/validation-result';
import { fromChecks, outcome, type CheckDetail } from '@engine/validation-result';
import { defineValidator, type Validator } from '@engine/validator';
import { walkJson, type JsonVisit } from '@utils/json';
import { responseData } from '../support';

export interface FieldConventionOptions {
  name: string;
  noun: string;
  description: string;
  severity?: Severity;
  /** Field names this convention applies to (from apiConfig.dataConventions). */
  field: RegExp;
  /** Return a problem description or undefined. `null` values are never passed. */
  check(value: unknown, visit: JsonVisit): string | undefined;
  /** Additional cross-field checks. */
  extraChecks?(data: unknown, context: ValidationContext): CheckDetail[];
}

/**
 * Validates response fields by naming convention (`id`, `*Id`, `*At`, `email`, `*Url`, `is*`),
 * independent of whether the endpoint's schema is strict. One factory, five validators.
 */
export function createFieldConventionValidator(options: FieldConventionOptions): Validator {
  return defineValidator({
    name: options.name,
    category: 'COMMON_DATA',
    severity: options.severity ?? 'MEDIUM',
    description: options.description,
    toggle: 'commonData',
    dependsOn: ['response.status-code'],
    appliesTo: (context) => {
      const data = responseData(context);
      return data.ok ? true : data.reason;
    },
    check: (context) => {
      const data = responseData(context);
      if (!data.ok) return outcome.skipped(data.reason);
      const checks: CheckDetail[] = walkJson(data.value)
        .filter((visit) => options.field.test(visit.key) && visit.value !== null)
        .map((visit) => {
          const problem = options.check(visit.value, visit);
          return {
            name: visit.path,
            status: problem ? 'FAILED' : 'PASSED',
            actual: visit.value,
            message: problem,
          };
        });
      checks.push(...(options.extraChecks?.(data.value, context) ?? []));
      return fromChecks(checks, `${options.noun} checks`, `no ${options.noun} fields in response`);
    },
  });
}
