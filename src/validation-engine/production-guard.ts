import { env } from '@config/env';
import type { ResolvedEndpoint } from './validation-policy';

export class ProductionSafetyError extends Error {
  override readonly name = 'ProductionSafetyError';
}

export interface SafetyFlags {
  isProduction: boolean;
  allowDestructive: boolean;
}

/**
 * Reason a data-mutating endpoint must not be called, or undefined when it may be.
 * Enforced inside the executor, so setup calls and probes are covered too — not just tests.
 */
export function destructiveBlockReason(
  endpoint: Pick<ResolvedEndpoint, 'destructive' | 'label'>,
  flags: SafetyFlags = {
    isProduction: env.IS_PRODUCTION,
    allowDestructive: env.ALLOW_DESTRUCTIVE_TESTS,
  },
): string | undefined {
  if (!endpoint.destructive || !flags.isProduction || flags.allowDestructive) return undefined;
  return `${endpoint.label} mutates data and TEST_ENV=production (set ALLOW_DESTRUCTIVE_TESTS=true to override)`;
}
