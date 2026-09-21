import { thresholds } from '@config/thresholds.config';
import type { ValidationContext } from './validation-context';
import type { ValidationResult } from './validation-result';
import type { Validator } from './validator';

/**
 * A failure is only a defect once it has failed **again**.
 *
 * ## The problem this solves
 *
 * The validity gate already refuses findings whose *evidence* is environmental — a gateway 502, a
 * socket hang-up, a 429. It cannot catch the harder case: a check that failed for no visible
 * reason and would pass a second later. A slow first response that grazed a latency budget, a read
 * that raced a concurrent write, a session that refreshed mid-probe. Each produces evidence that
 * looks exactly like a real defect, and each files a ticket a developer cannot reproduce.
 *
 * So a FAILED result is re-run before it is believed: up to `attempts` passes with exponential
 * backoff, and it only stays FAILED if **every** pass fails. One pass succeeding downgrades it to
 * a WARNING that is reported but never filed.
 *
 * ## Why this lives here and not in the reporter
 *
 * By the time the Bugzilla reporter sees a result, the run is over — the request, the token and the
 * server state are gone, so "try it again" is no longer possible. The only place a check can be
 * repeated is where it was executed. That is the whole reason this is an engine concern.
 *
 * ## What is deliberately NOT retried
 *
 * Retrying costs real traffic, and for most validators it cannot change the answer:
 *
 *  - **Deterministic checks.** A missing `X-Content-Type-Options` header on a response already in
 *    hand will be missing on every re-read. Re-running a `primary`-stage validator only re-inspects
 *    the same recorded exchange, so it is pure cost.
 *  - **Non-idempotent probes.** `concurrency.duplicate-write` writes rows; re-running it three
 *    times would leave three times the mess and, worse, its *second* run genuinely finds the row
 *    the first one created — so a retry would turn a pass into a false failure.
 *
 * Both are excluded by `isRetryable`. The result is that retries are spent only where a flake is
 * actually possible: on probes that send fresh requests.
 */

export interface ReproductionOutcome {
  result: ValidationResult;
  /** How many passes ran. 1 means the check was not eligible for retry, or passed first time. */
  attempts: number;
  /** How many of those passes failed. */
  failures: number;
  /**
   * True when every pass failed, so the finding is reproducible and may be filed. False for a
   * check that recovered — reported, but never turned into a ticket.
   */
  reproduced: boolean;
}

/**
 * Whether re-running this validator can produce a different answer.
 *
 * Only `probe` and `database` stages qualify: they issue fresh work (a new request, a new query).
 * `primary` and `aggregate` validators re-read exchanges already captured, so a second pass is
 * guaranteed to reach the identical verdict.
 */
export function isRetryable(validator: Pick<Validator, 'stage' | 'name'>): boolean {
  if (NON_IDEMPOTENT.has(validator.name)) return false;
  return validator.stage === 'probe' || validator.stage === 'database';
}

/**
 * Probes whose second run is not comparable with the first, because the first changed the world.
 *
 * `concurrency.duplicate-write` is the clear case: pass 1 creates a row, so pass 2 races against
 * that row rather than against a clean slate. Retrying would manufacture the very failure it is
 * looking for.
 */
const NON_IDEMPOTENT = new Set<string>(['concurrency.duplicate-write']);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff: base, base×2, base×4 … capped so a run cannot stall on one check. */
export function backoffMs(attempt: number): number {
  const { baseDelayMs, maxDelayMs } = thresholds.reproduction;
  return Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
}

/**
 * Runs `execute` once, and — if it failed and the validator is eligible — again, up to the
 * configured number of passes.
 *
 * Returns the LAST failing result when the finding reproduces, so the ticket carries the freshest
 * evidence. When the check recovers, the passing result is returned with its message rewritten to
 * record that it flaked, because a silently-green result would hide a real instability from
 * whoever reads the report.
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
    /*
     * One clean pass is enough to disqualify the finding. Continuing would only find more evidence
     * for a conclusion already reached — this is not a defect we can hand to a developer.
     */
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
