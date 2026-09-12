import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import type { ValidationProfile } from '@config/constants';
import type { ValidationContext } from '@engine/validation-context';
import { outcome, type Severity, type ValidationOutcome } from '@engine/validation-result';
import { getPath } from '@utils/json';
import { NamedRegistry } from '@utils/named-registry';

/**
 * Endpoint-specific business logic (licence limits, duplicates, blocked companies, ...).
 * Kept out of the central validators on purpose; endpoints opt in via `businessRules: [...]`.
 */
export interface BusinessRule {
  id: string;
  description: string;
  severity: Severity;
  /** Default: REGRESSION and FULL. */
  profiles?: readonly ValidationProfile[];
  /** Central validators that must pass first, e.g. `response.status-code`. */
  dependsOn?: readonly string[];
  check(context: ValidationContext): Promise<ValidationOutcome>;
}

export class BusinessRuleRegistry extends NamedRegistry<BusinessRule> {
  constructor() {
    super('Business rule');
  }
}

/** Asserts a business rejection: expected HTTP status and machine-readable error code. */
export function expectBusinessError(
  exchange: ApiResponseWrapper,
  status: number,
  code: string,
): ValidationOutcome {
  const parsed = exchange.json();
  const actualCode = parsed.ok ? getPath(parsed.value, 'code') : undefined;
  const extras = {
    expected: { status, code },
    actual: { status: exchange.status, code: actualCode },
    correlationId: exchange.correlationId,
  };
  return exchange.status === status && actualCode === code
    ? outcome.passed(`rejected with ${status} ${code}`, extras)
    : outcome.failed(
        `expected ${status} ${code}, got ${exchange.status} ${String(actualCode)}`,
        extras,
      );
}
