import { maskString } from '@utils/masking';

/**
 * What the bench created on a target, and what has happened to it since.
 *
 * Phase 2 §17.4 — the TRACK half of `allocate → create → track → test → cleanup → release`. This
 * file defines the record and the state machine; **nothing here deletes anything.** Performing
 * cleanup, and the sweeper that acts on the journal, are later phases by design: automated deletion
 * driven by a file needs its own safety review, and this phase deliberately does not smuggle it in.
 *
 * The point of recording at all: in-memory tracking dies with the process. If a worker is killed, a
 * resource it created would otherwise become an **unknown** record on the test environment — it
 * exists, nothing knows who made it, and nobody can tell it from real data.
 */

/**
 * The controlled lifecycle of a tracked resource. Free-form state strings are not allowed: the
 * transition table below is what makes a half-finished cleanup legible after a crash.
 *
 *   REGISTERED ──► CLEANUP_PENDING ──► CLEANED
 *                                  └─► CLEANUP_FAILED ──► CLEANUP_PENDING (a retry)
 *
 * A resource still `REGISTERED` when a run ends was never cleaned up — that is the orphan signal.
 */
export const RESOURCE_STATES = [
  'REGISTERED',
  'CLEANUP_PENDING',
  'CLEANED',
  'CLEANUP_FAILED',
] as const;
export type ResourceState = (typeof RESOURCE_STATES)[number];

export function isResourceState(value: unknown): value is ResourceState {
  return typeof value === 'string' && (RESOURCE_STATES as readonly string[]).includes(value);
}

/**
 * Which transitions are legal. Centralised so no caller can invent one, and so "cleanup was
 * attempted twice" or "cleaned then failed" cannot quietly corrupt the history.
 *
 * `CLEANUP_FAILED → CLEANUP_PENDING` is allowed on purpose: a later phase may retry a failed
 * delete. `CLEANED` is terminal — a resource that is gone cannot become pending again.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<ResourceState, readonly ResourceState[]>> = {
  REGISTERED: ['CLEANUP_PENDING'],
  CLEANUP_PENDING: ['CLEANED', 'CLEANUP_FAILED'],
  CLEANUP_FAILED: ['CLEANUP_PENDING'],
  CLEANED: [],
};

export function canTransition(from: ResourceState, to: ResourceState): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function allowedTransitionsFrom(state: ResourceState): readonly ResourceState[] {
  return ALLOWED_TRANSITIONS[state] ?? [];
}

/**
 * Who owns a resource. The four parts together are its identity, which is what keeps two runs, two
 * test cases or two account slots from overwriting each other when the target hands out similar ids
 * (a message id of `1` means nothing without knowing whose run and whose account made it).
 *
 * `slot` is the LOGICAL account slot from Phase 2.3 (`parallelIndex`), or `null` when the resource
 * belongs to no account — stated explicitly rather than invented.
 */
export interface ResourceOwner {
  runId: string;
  /** Stable identity of the test that created it (Phase 2.2). Never `validationId`. */
  testCaseId: string;
  slot: number | null;
}

export interface ResourceIdentity extends ResourceOwner {
  /** Resource type, e.g. `katchup-message`, `group`, `admin-tier`. */
  kind: string;
  /** The identifier a future cleanup would use to delete it. */
  id: string;
}

export interface ResourceRecord extends ResourceIdentity {
  /** Human label, masked before it is ever persisted. */
  describe: string;
  registeredAt: string;
  state: ResourceState;
  /** Why the last cleanup attempt ended as it did; `null` until one is attempted. */
  cleanupResult: string | null;
  /** When the state last changed; `null` while still `REGISTERED`. */
  updatedAt: string | null;
}

/** The canonical key for a resource. Identity is ownership + kind + id, in that order. */
export function resourceKey(identity: ResourceIdentity): string {
  const slot = identity.slot === null ? 'none' : String(identity.slot);
  return [identity.runId, slot, identity.testCaseId, identity.kind, identity.id].join('|');
}

/**
 * Everything written to the journal passes through here.
 *
 * The bench already has one masking implementation (`src/utils/masking.ts`) covering passwords,
 * JWTs, Bearer/Basic credentials, connection strings and e-mail addresses; reusing it means the
 * journal cannot drift from the rest of the bench's redaction. A label or a failure reason is the
 * only free text a record carries, so those are the only fields that need it — an id and a kind are
 * identifiers by construction.
 */
/**
 * `key=value` secrets in free text, which `maskString` does not cover: it masks JWTs, auth schemes,
 * connection strings and e-mail addresses, but a label like `created with password=hunter2` would
 * otherwise be persisted verbatim. The key vocabulary mirrors `isSensitiveKey` in
 * `src/utils/masking.ts`, so the journal and the rest of the bench agree on what counts as a secret.
 * Scoped to this function on purpose — it changes nothing about masking anywhere else.
 */
const SECRET_ASSIGNMENT =
  /\b((?:pass(?:word)?|pwd|secret|token|authorization|api[-_]?key|apikey|cookie|session(?:id)?|credential|private[-_]?key|refresh[-_]?token|access[-_]?token)[a-z_-]*)\s*[:=]\s*("?)([^\s"',;&]+)\2/gi;

export function redactForJournal(value: string): string {
  return maskString(value).replace(SECRET_ASSIGNMENT, (_match, key: string) => `${key}=***`);
}
