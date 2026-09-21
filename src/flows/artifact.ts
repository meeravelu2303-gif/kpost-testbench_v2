/**
 * Typed artifacts — the values one flow step produces and a later step consumes.
 *
 * ## The problem this solves
 *
 * Today a multi-step Katchup flow carries `msgID` between steps in a local variable, and between
 * TESTS in a module-level `let` under `describe.configure({ mode: 'serial' })`
 * (`tests/api/kpost/katchup/lifecycle.spec.ts:29`). Both are invisible to the framework: nothing can
 * tell that the recall step *needs* the send step's id, so nothing can tell that a recall assertion
 * is meaningless when the send never happened.
 *
 * An artifact makes that dependency a declared, checkable fact instead of a closure variable.
 *
 * ## Why a phantom-typed key rather than a string
 *
 * A bare `string` key would put us back to "arbitrary string lookups scattered through tests": any
 * typo compiles, and every read needs a cast. `FlowArtifact<T>` carries the value type in a phantom
 * field, so `run.require(MESSAGE_ID)` is `number` at the call site with no cast and no `any`, and a
 * misspelled key is a compile error rather than an `undefined` at runtime.
 *
 * The phantom field is **never present at runtime** — it exists only to make `T` load-bearing for
 * the type checker, which is what stops `FlowArtifact<number>` and `FlowArtifact<string>` being
 * silently interchangeable.
 *
 * ## What an artifact is NOT
 *
 * It is not application state. `messageId` is *a value this run produced*; whether the message is
 * SENT, READ or RECALLED is a State-model question and is deliberately out of scope here
 * (Phase 2B explicitly excludes the State model). An artifact answers only "did an earlier step
 * hand this forward?".
 */

/**
 * A declared value that flows between steps.
 *
 * Create one with `defineArtifact`; never construct the object literal directly, so every artifact
 * in the system has an id and a description.
 */
export interface FlowArtifact<T> {
  /** Stable id, unique within a flow. Used in declarations and in blocked-step reasons. */
  readonly artifactId: string;
  /** What the value is, for a human reading a blocked-step report. */
  readonly describe: string;
  /**
   * Phantom type carrier. Never assigned, never read, never serialised — it exists so that `T`
   * participates in type checking.
   *
   * Declared **covariantly** (`?: T`, not `?: (value: T) => T`). That is the property that makes
   * `FlowArtifact<number>` assignable to `FlowArtifact<unknown>`, which a step's `produces` /
   * `consumes` arrays need, while still keeping `FlowArtifact<string>` and `FlowArtifact<number>`
   * mutually unassignable — `string | undefined` is not assignable to `number | undefined`. A
   * function-typed phantom is invariant and would have made the declaration arrays impossible to
   * write without casts, which is the opposite of the safety this key exists to provide.
   */
  readonly __artifactType?: T;
}

/** Any artifact, for declaration arrays where the element types legitimately differ. */
export type AnyFlowArtifact = FlowArtifact<unknown>;

/**
 * Declares an artifact.
 *
 * ```ts
 * const MESSAGE_ID = defineArtifact<number>('messageId', 'the msgID the send returned');
 * ```
 */
export function defineArtifact<T>(artifactId: string, describe: string): FlowArtifact<T> {
  if (!artifactId.trim()) throw new Error('an artifact needs a non-empty artifactId');
  if (!describe.trim()) throw new Error(`artifact "${artifactId}" needs a description`);
  return { artifactId, describe };
}
