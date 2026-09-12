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
 * How far outside the test's own data an endpoint reaches.
 *
 * `destructive` alone was too blunt. It blocked writes on production and allowed them everywhere
 * else, which is right for creating a throwaway user — and wrong for the three kinds of call below,
 * where a "dev" environment is no safer than production:
 *
 *   `data`      creates or changes records the tests own. Safe off production. The default.
 *   `external`  sends something to a real person: an SMS, an email. Costs money, annoys humans,
 *               and trips carrier rate limits that then break every later test.
 *   `global`    changes state shared by everyone on the environment: the mobile app version every
 *               client is told to install, or another account's password.
 *
 * `external` and `global` are blocked on **every** environment unless `ALLOW_DESTRUCTIVE_TESTS=true`,
 * so running the suite cannot text somebody by accident. Turning the flag on is a deliberate act;
 * the endpoints are fully tested when it is.
 */
export type SideEffect = 'data' | 'external' | 'global';

const REASONS: Record<Exclude<SideEffect, 'data'>, string> = {
  external: 'sends a real SMS or email',
  global: 'changes state shared by the whole environment',
};

/**
 * Reason a mutating endpoint must not be called, or undefined when it may be.
 * Enforced inside the executor, so setup calls and probes are covered too — not just tests.
 */
export function destructiveBlockReason(
  endpoint: Pick<ResolvedEndpoint, 'destructive' | 'label'> & { sideEffect?: SideEffect },
  flags: SafetyFlags = {
    isProduction: env.IS_PRODUCTION,
    allowDestructive: env.ALLOW_DESTRUCTIVE_TESTS,
  },
): string | undefined {
  if (!endpoint.destructive || flags.allowDestructive) return undefined;

  const sideEffect = endpoint.sideEffect ?? 'data';
  if (sideEffect !== 'data') {
    return `${endpoint.label} ${REASONS[sideEffect]} (set ALLOW_DESTRUCTIVE_TESTS=true to run it)`;
  }
  if (!flags.isProduction) return undefined;
  return `${endpoint.label} mutates data and TEST_ENV=production (set ALLOW_DESTRUCTIVE_TESTS=true to override)`;
}
