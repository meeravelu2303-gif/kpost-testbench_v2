import type { ActorRoleId } from '../actors/index';
import type { StateObservation } from '../state-observation/index';
import type {
  CalibrationAttempt,
  CalibrationCleanupRecord,
  CalibrationFinding,
  CalibrationRecord,
  CalibrationResult,
} from './calibration-result';

/**
 * CalibrationSession — collects the observations of ONE controlled scenario.
 *
 * ## Isolation, the same way every other run-scoped thing in this repository works
 *
 * No module-level state. Everything a scenario records lives on the instance, so two scenarios
 * cannot contaminate each other's before/after comparison — which would be the single most
 * misleading failure mode available here.
 *
 * ## It records; it does not judge
 *
 * `record()` stores what was observed. Findings are produced by pure derivation functions given the
 * session, never by the session deciding anything as values arrive. Nothing in this file compares a
 * value with an expectation.
 */
export class CalibrationSession {
  private readonly entries: CalibrationRecord[] = [];
  private readonly cleanupRecords: CalibrationCleanupRecord[] = [];
  private readonly findingRecords: CalibrationFinding[] = [];
  private readonly attemptRecords: CalibrationAttempt[] = [];

  constructor(
    readonly scenarioId: string,
    readonly startedAt: string = new Date().toISOString(),
    readonly runId?: string,
  ) {}

  /** Records the observations produced by one step of the scenario. */
  record(
    phase: string,
    observations: readonly StateObservation[],
    options: { actorRole?: ActorRoleId } = {},
  ): this {
    for (const observation of observations) {
      this.entries.push({
        phase,
        ...(options.actorRole ? { actorRole: options.actorRole } : {}),
        observation,
      });
    }
    return this;
  }

  /** Everything recorded, in the order it was observed. */
  records(): readonly CalibrationRecord[] {
    return [...this.entries];
  }

  /** The phases recorded so far, in first-seen order. */
  phases(): string[] {
    return [...new Set(this.entries.map((entry) => entry.phase))];
  }

  /**
   * The observations matching a phase/field/resource selector.
   *
   * Resource id is part of the selector because a response usually carries many rows, and comparing
   * the wrong row across phases would fabricate a transition that never happened.
   */
  select(filter: {
    phase?: string;
    stateKey?: string;
    resourceId?: string;
    observationId?: string;
  }): CalibrationRecord[] {
    return this.entries.filter((entry) => {
      if (filter.phase !== undefined && entry.phase !== filter.phase) return false;
      if (filter.stateKey !== undefined && entry.observation.stateKey !== filter.stateKey) {
        return false;
      }
      if (filter.resourceId !== undefined && entry.observation.resourceId !== filter.resourceId) {
        return false;
      }
      if (
        filter.observationId !== undefined &&
        entry.observation.observationId !== filter.observationId
      ) {
        return false;
      }
      return true;
    });
  }

  /** The single observation for a phase/field/resource, or `undefined` when it was not captured. */
  one(filter: {
    phase: string;
    stateKey: string;
    resourceId: string;
  }): StateObservation | undefined {
    return this.select(filter)[0]?.observation;
  }

  /**
   * Records what an observation ATTEMPT looked like.
   *
   * Recorded whether or not the attempt found anything — an empty result is only interpretable
   * beside the shape of the response that produced it.
   */
  addAttempt(attempt: CalibrationAttempt): this {
    this.attemptRecords.push(attempt);
    return this;
  }

  attempts(): readonly CalibrationAttempt[] {
    return [...this.attemptRecords];
  }

  /** Records a finding produced by a derivation. */
  addFinding(finding: CalibrationFinding): this {
    this.findingRecords.push(finding);
    return this;
  }

  findings(): readonly CalibrationFinding[] {
    return [...this.findingRecords];
  }

  /** Records a cleanup outcome. Reported separately from observations, never mixed in. */
  addCleanup(record: CalibrationCleanupRecord): this {
    this.cleanupRecords.push(record);
    return this;
  }

  cleanup(): readonly CalibrationCleanupRecord[] {
    return [...this.cleanupRecords];
  }

  /** The serialisable result. Contains observations and findings — never a response body. */
  result(): CalibrationResult {
    return {
      scenarioId: this.scenarioId,
      ...(this.runId !== undefined ? { runId: this.runId } : {}),
      startedAt: this.startedAt,
      records: this.records(),
      findings: this.findings(),
      attempts: this.attempts(),
      cleanup: this.cleanup(),
    };
  }
}
