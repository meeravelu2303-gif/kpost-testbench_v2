import type { Provenance } from './provenance';
import type { StateResourceId } from './vocabulary';

/**
 * Observation — how the bench *could* obtain a state value.
 *
 * Phase 4B. This is the answer to "where would I look?", and deliberately never to "what is it now?".
 *
 * ## The boundary this type enforces by its shape
 *
 * An `Observation` has **no field capable of holding a value, an expectation or a verdict**. There is
 * no `value`, no `expected`, no `current`, no `actual`, no `passed`. That is not an oversight and not
 * a convention — it is the whole point, and a framework guard asserts no such key ever appears.
 *
 * The reason is the failure Phase 4A measured. The repository already contains claims like a UI
 * catalogue marking "read receipt + open state" as `built` when the open state is asserted nowhere,
 * and a mail-send endpoint tagged as satisfying "read receipts". Those are claims about runtime truth
 * living in declarative data, and once there, nothing can tell them from measurements. A record that
 * *cannot* express a runtime value cannot become a false claim about one.
 *
 * A state value is evidence, and evidence belongs to a run — to the existing exchange/evidence layer,
 * not here.
 *
 * ## `runsOnLive`
 *
 * Whether the endpoint executes on the **default live pass**, as the generated
 * `docs/LIVE-ENDPOINTS.md` reports it. `false` does not mean unreachable: most `false` entries are
 * driven by a gated `*_LIFECYCLE` flow because they need a runtime id. It is a statement about the
 * default run, which is what determines whether an observation is available without extra setup.
 */
export interface Observation {
  /** Stable id, e.g. `katchup.message.read-via-conversation`. */
  readonly observationId: string;
  readonly resource: StateResourceId;
  /**
   * The `stateId`s this observation could reveal. Several, because one field often carries several
   * states (`status` distinguishes Sent from Read) and one call often returns several fields.
   */
  readonly observes: readonly string[];
  /** The registered endpoint id. A string, so this module never imports the API layer. */
  readonly endpointId: string;
  /**
   * Where in the response the value sits, spelled explicitly — `data[].status`,
   * `value.kmailTransactionList[].readStatus`. `[]` marks an array to walk. Explicit because a path
   * that is merely implied is the thing that rots first.
   */
  readonly fieldPath: string;
  /** Whether the endpoint runs on the default live pass. */
  readonly runsOnLive: boolean;
  readonly provenance: Provenance;
  /** Any limit on what this observation can actually answer. */
  readonly note?: string;
}

/**
 * Keys an `Observation` must never carry, asserted by the framework guard.
 *
 * Listed as data rather than left to review, because the pressure to add one of these arrives exactly
 * when someone is in a hurry.
 */
export const FORBIDDEN_OBSERVATION_KEYS = [
  'value',
  'values',
  'expected',
  'expectedValue',
  'actual',
  'actualValue',
  'current',
  'currentState',
  'observedValue',
  'result',
  'passed',
  'verdict',
] as const;
