import type { ResourceIdentity, ResourceOwner } from './resource-record';

/**
 * What this process created — the ownership the QA-identifier guard consults.
 *
 * ## Why this exists
 *
 * The guard refuses any request to a real host that names an identifier we do not own, and it decides
 * that by comparing the value against the `QA_*` values in `.env` (see `qa-identifier-guard.ts`).
 * That works for **tenant** identifiers — a kpostID, a company, a contact — because those are fixed
 * and can be written down in advance.
 *
 * It cannot work for a **runtime** resource: a message this run just sent has an id the API mints,
 * so no `.env` file could name it. Until now the only answer was to exempt the whole field in
 * `NOT_A_RESOURCE` (`msgid`, `kallid`, `groupid` are all exempted that way), which buys the lifecycle
 * its cleanup at the cost of switching the guard off for that field entirely — a foreign id under the
 * same key would sail through.
 *
 * This registry is the third option, and the one that keeps the safety property: the ledger says what
 * this run created, and the guard allows a runtime-id field to name **those ids and no others**. A
 * foreign message id under the same key is still refused, because nothing ever registered it.
 *
 * ## The ownership model
 *
 * A resource is owned when `ResourceLedger.register()` recorded it in this process — which happens at
 * the moment the resource comes into existence, from the response that created it. So membership here
 * means "this run, in this worker, created this id and holds it in its ledger". It is never inferred
 * from a payload, a response or a naming convention, and nothing outside the ledger writes to it.
 *
 * Two narrower checks sit on either side of it and are unaffected:
 *
 *  - the **cleanup coordinator** enforces per-TEST ownership (a test may only clean up what its own
 *    ledger record covers), so this process-wide set is not the only gate; and
 *  - the **production guard** still decides whether the endpoint may be called on a real host at all.
 *
 * Ownership is remembered for the life of the process rather than released on `CLEANED`, so a retried
 * cleanup of a `CLEANUP_FAILED` resource is still recognised as ours. A worker never sees another
 * worker's ids, which is the correct direction to err: it can only ever refuse too much.
 */

/** kind → id → the owner that registered it. */
const owned = new Map<string, Map<string, ResourceOwner>>();

function normalise(id: string | number): string {
  return String(id).trim().toLowerCase();
}

/**
 * Records a resource as created by this run. Called by the ledger on registration — the single point
 * where a resource becomes this run's responsibility — and by nothing else.
 */
export function rememberOwnedResource(identity: ResourceIdentity): void {
  const byId = owned.get(identity.kind) ?? new Map<string, ResourceOwner>();
  byId.set(normalise(identity.id), {
    runId: identity.runId,
    testCaseId: identity.testCaseId,
    slot: identity.slot,
  });
  owned.set(identity.kind, byId);
}

/** Whether this run created `id` as a resource of `kind`. */
export function ownsResource(kind: string, id: string | number): boolean {
  return owned.get(kind)?.has(normalise(id)) ?? false;
}

/** Who registered it, for an error message or a test. `undefined` when it is not ours. */
export function ownerOfResource(kind: string, id: string | number): ResourceOwner | undefined {
  return owned.get(kind)?.get(normalise(id));
}

/** Every id this run owns of one kind, in registration order. */
export function ownedResourceIds(kind: string): string[] {
  return [...(owned.get(kind)?.keys() ?? [])];
}

/**
 * Empties the registry. For tests only — a run must never forget what it created, or the guard would
 * start refusing the cleanup of resources that are genuinely ours.
 */
export function forgetOwnedResources(): void {
  owned.clear();
}
