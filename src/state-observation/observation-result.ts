import type { StateResourceId } from '../states/index';
import type { ValuePresence } from './path';

/**
 * StateObservation — one application-state value, as a response actually returned it.
 *
 * ## What it is
 *
 *     "endpoint katchup-conversation returned, for msgID 8101, status = 2,
 *      at data[1].status, in the exchange correlated as tb-…"
 *
 * ## What it is NOT
 *
 * It is not a verdict. There is **no field capable of holding an expectation, a comparison or a
 * result** — no `expected`, no `pass`, no `failed`, no `correct`, no `verdict` — and a framework
 * guard asserts none ever appears. The output of this layer is `OBSERVED`, never `PASS` or `FAIL`.
 * Judging an observed value against an expectation is assertion work, and the specs and validators
 * that already do it keep doing it; this layer only makes the value available to them.
 *
 * ## Why the raw response is not copied in
 *
 * The full body stays where it already is. An observation references the exchange by
 * `correlationId` — the key `ExchangeEvidence` is built around — so the captured evidence remains
 * the single source for the response, with Phase 3.2's masking and size bounds intact. Duplicating
 * the body here would create a second, unmasked copy of exactly the material that layer exists to
 * contain.
 */
export interface StateObservation {
  /** The Phase 4B observation definition that produced this, so the chain is traceable. */
  readonly observationId: string;
  readonly resource: StateResourceId;

  /**
   * Which instance the value belongs to, as a string (ids arrive as numbers and strings alike).
   * `undefined` only when the row carried no identity field — never guessed, never inherited from a
   * neighbouring row.
   */
  readonly resourceId?: string;
  /** The enclosing instance, where the resource is only unique within a parent (a KMail mail). */
  readonly parentResourceId?: string;
  /** How the identity field was found. `ABSENT` means the observation is explicitly unattributed. */
  readonly identityPresence: ValuePresence;

  /** The field the value came from, in the application's own spelling — `status`, `readStatus`. */
  readonly stateKey: string;
  /** The declared path from the Phase 4B definition. */
  readonly fieldPath: string;
  /** The concrete location with indices resolved: `data[1].status`. */
  readonly location: string;

  readonly presence: ValuePresence;
  /**
   * The value exactly as returned — `2`, not `'READ'`; `'Y'`, not `true`. Never coerced, never
   * normalised. `undefined` when `presence` is `ABSENT`.
   */
  readonly rawValue: unknown;
  /**
   * Supplementary, never destructive: the Phase 4B state ids whose declared `rawValue` matches what
   * came back, on this field. Empty when the model declares no single-valued mapping (KMail's
   * flags are declared as `Y | N`, a range rather than one value) or when the value matches none.
   * `rawValue` above is always authoritative.
   */
  readonly matchedStateIds: readonly string[];

  readonly endpointId: string;
  /** The reference into the captured evidence. The response itself is NOT copied here. */
  readonly correlationId: string;
  readonly runId?: string;
  readonly testCaseId?: string;
  /** The probe label the exchange carried (`primary`, or a probe name). */
  readonly label?: string;
  readonly observedAt: string;

  /**
   * The acting identity, **only** when the caller already knew it from request context.
   *
   * Never derived from the response. A `sender`/`receiver` field in a payload names a participant of
   * the message, not the account that made the call, and treating one as the other is precisely how
   * the unresolved Katchup read-perspective question would get silently answered wrong.
   */
  readonly actorId?: string;
}

/**
 * Keys a `StateObservation` must never carry. Listed as data rather than left to review, because
 * the pressure to add one arrives exactly when someone is in a hurry.
 */
export const FORBIDDEN_RESULT_KEYS = [
  'expected',
  'expectedValue',
  'pass',
  'passed',
  'fail',
  'failed',
  'ok',
  'valid',
  'correct',
  'verdict',
  'result',
  'severity',
  'message',
] as const;
