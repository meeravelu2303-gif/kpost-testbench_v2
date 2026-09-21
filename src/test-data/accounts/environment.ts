import { TestAccountError, type TestAccountRecord } from './account-record';

/**
 * Which deployment an account belongs to.
 *
 * ## Derived from the host, never from a list
 *
 * The environment label IS the API hostname. That choice avoids the failure mode a fixed vocabulary
 * invites: a list of `test | staging | production` has to be mapped to a host by hand, the mapping
 * drifts, and an account created on one deployment silently becomes "valid" on another that happens
 * to carry the same label. A hostname cannot drift from itself.
 *
 * It also means **no environment name is hard-coded as acceptable** — in particular `production`
 * appears nowhere as a permitted value, because nothing here enumerates permitted values at all.
 * What may be targeted is decided by the existing safety controls (`assertTargetAllowed`, the
 * production guard, the QA-identifier guard), which this module deliberately does not duplicate.
 */

/**
 * The environment label for an API base URL.
 *
 * @throws TestAccountError when the URL is unusable — an account with no environment could be
 * reused anywhere, which is the one thing this must prevent.
 */
export function environmentOf(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new TestAccountError(
      'cannot determine an environment from an empty base URL — an account with no environment ' +
        'could be reused against any deployment',
    );
  }
  try {
    return new URL(trimmed).host.toLowerCase();
  } catch {
    throw new TestAccountError(
      `"${baseUrl}" is not a URL, so no environment can be derived from it`,
    );
  }
}

/** Whether a record belongs to the environment currently targeted. */
export function matchesEnvironment(record: TestAccountRecord, environment: string): boolean {
  return record.environment.toLowerCase() === environment.trim().toLowerCase();
}

/**
 * Refuses to use an account from another deployment.
 *
 * The error names both sides, because the confusing case is not "no account" but "an account that
 * looks right and answers 401", which reads as an application defect rather than a configuration
 * mistake — the exact misreading this repository has been bitten by before.
 */
export function assertSameEnvironment(record: TestAccountRecord, environment: string): void {
  if (matchesEnvironment(record, environment)) return;
  throw new TestAccountError(
    `account "${record.accountId}" belongs to ${record.environment}, but the run targets ` +
      `${environment}. The same id on another deployment is a different account; it would ` +
      'authenticate as nobody and the failure would look like a product defect.',
  );
}
