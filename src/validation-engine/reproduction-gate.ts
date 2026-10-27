import { thresholds } from '@config/thresholds.config';
import type { ValidationContext } from './validation-context';
import type { ValidationResult } from './validation-result';
import type { Validator } from './validator';

/**
 * A failure is a defect only once it fails again: a FAILED probe is re-run with backoff and stays
 * FAILED only if every pass fails; otherwise it becomes an unfiled WARNING. Lives in the engine
 * because only there can a check be repeated. Deterministic and non-idempotent checks are not
 * retried.
 */

export interface ReproductionOutcome {
  result: ValidationResult;
  /** How many passes ran. 1 means the check was not eligible for retry, or passed first time. */
  attempts: number;
  /** How many of those passes failed. */
  failures: number;
  /** True when every pass failed, so the finding may be filed. */
  reproduced: boolean;
}

/** Whether a re-run can disagree: only `probe` and `database` stages issue fresh work. */
export function isRetryable(validator: Pick<Validator, 'stage' | 'name'>): boolean {
  if (NON_IDEMPOTENT.has(validator.name)) return false;
  return validator.stage === 'probe' || validator.stage === 'database';
}

/** Probes whose first run changes state, so a retry would manufacture the failure it looks for. */
const NON_IDEMPOTENT = new Set<string>(['concurrency.duplicate-write']);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff: base, base×2, base×4 … capped so a run cannot stall on one check. */
export function backoffMs(attempt: number): number {
  const { baseDelayMs, maxDelayMs } = thresholds.reproduction;
  return Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
}

/**
 * Runs `execute`, retrying an eligible failure. Returns the last failing result when it reproduces,
 * or the passing result marked as a flake when it recovers.
 */
export async function confirmFailure(
  validator: Validator,
  context: ValidationContext,
  execute: () => Promise<ValidationResult>,
): Promise<ReproductionOutcome> {
  const first = await execute();
  const { attempts: maxAttempts } = thresholds.reproduction;

  if (first.status !== 'FAILED' || maxAttempts <= 1 || !isRetryable(validator)) {
    return {
      result: first,
      attempts: 1,
      failures: first.status === 'FAILED' ? 1 : 0,
      // A deterministic check that failed IS reproducible — re-running it could not disagree.
      reproduced: first.status === 'FAILED',
    };
  }

  let failures = 1;
  let last = first;
  let recovered: ValidationResult | undefined;

  for (let attempt = 2; attempt <= maxAttempts; attempt += 1) {
    await sleep(backoffMs(attempt - 1));
    context.log.debug(
      `${validator.name} failed; reproduction pass ${attempt}/${maxAttempts} for ${context.endpoint.label}`,
    );
    const retry = await execute();
    if (retry.status === 'FAILED') {
      failures += 1;
      last = retry;
      continue;
    }
    // One clean pass disqualifies the finding.
    recovered = retry;
    break;
  }

  if (recovered) {
    return {
      result: {
        ...recovered,
        status: 'WARNING',
        message:
          `intermittent: failed ${failures} of ${failures + 1} passes, then succeeded — ` +
          `not filed (first failure: ${first.message})`,
        details: first.details,
        expected: first.expected,
        actual: first.actual,
      },
      attempts: failures + 1,
      failures,
      reproduced: false,
    };
  }

  return {
    result: {
      ...last,
      message: `${last.message} (reproduced in ${failures}/${maxAttempts} passes)`,
    },
    attempts: maxAttempts,
    failures,
    reproduced: true,
  };
}
