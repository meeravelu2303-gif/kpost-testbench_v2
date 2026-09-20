import path from 'node:path';
import type { TestCase, TestResult } from '@playwright/test/reporter';
import {
  apiTestCaseId,
  detectCollisions,
  specIdentityKey,
  specTestCaseId,
  TEST_CASE_ID_ANNOTATION,
  type RegisteredCase,
  type TestCaseIdCollision,
} from './test-case-id';
import type { ValidationReport } from '../validation-engine/validation-result';

/**
 * The run's case registry: one row per executed test case, keyed by its STABLE id.
 *
 * Phase 2.2 scope, deliberately narrow. It records IDENTITY and outcome — what ran and how it ended —
 * so a case can be followed across runs. The richer per-case record (accounts, cleanup status,
 * request/response detail) belongs to the later reporting step and is not invented here.
 *
 * It replaces nothing: `validationId` still identifies each execution, the `[KP-…]` tag still
 * identifies each defect, and neither is derived from or affected by anything in this file.
 */

export interface CaseRecord {
  /** Stable identity of the test DEFINITION (`TC-…`). */
  testCaseId: string;
  /** Playwright project (browser/suite) — execution metadata, deliberately NOT part of the id. */
  project: string;
  spec: string;
  title: string;
  status: 'passed' | 'failed' | 'skipped' | 'flaky' | 'unknown';
  durationMs: number;
  /** Present for engine-produced cases: the execution identity of the matching validation result. */
  validationId?: string;
  endpoint?: string;
  validator?: string;
  failureReason?: string;
}

/** Playwright's outcome vocabulary → the report's. */
function statusOf(test: TestCase, result: TestResult): CaseRecord['status'] {
  const outcome = test.outcome();
  if (outcome === 'skipped' || result.status === 'skipped') return 'skipped';
  if (outcome === 'flaky') return 'flaky';
  if (outcome === 'expected') return 'passed';
  if (outcome === 'unexpected') return 'failed';
  return 'unknown';
}

/**
 * The id a finished test reports under.
 *
 * An annotation wins when present — that is how a generated API case (and any spec that pins one)
 * states its identity explicitly. Otherwise it is derived from the spec file and the title path,
 * which is what makes hand-written tests work with no author effort. The Playwright PROJECT is never
 * part of it: the same test on Chromium, Firefox and WebKit is one case, the same rule the bench
 * already applies to UI defect fingerprints.
 */
export function testCaseIdOf(test: TestCase): { id: string; identityKey: string } {
  return deriveTestCaseId({
    file: test.location.file,
    titlePath: test.titlePath(),
    projectName: test.parent.project()?.name,
    pinned: test.annotations.find((a) => a.type === TEST_CASE_ID_ANNOTATION)?.description,
  });
}

export interface TestCaseIdInput {
  /** Absolute path of the spec file. */
  file: string;
  /** Playwright's title path, which includes the project and file entries this strips. */
  titlePath: readonly string[];
  projectName: string | undefined;
  /** An id the test pinned itself (the generated-case annotation). */
  pinned?: string;
}

/**
 * The single derivation, shared by the reporter (which sees `TestCase`) and the fixtures (which see
 * `TestInfo`). Keeping it in one place is what stops a test's id differing between the run and the
 * report — the two would then disagree about which check owns a resource.
 */
export function deriveTestCaseId(input: TestCaseIdInput): { id: string; identityKey: string } {
  const specFile = path.relative(process.cwd(), input.file).replace(/\\/g, '/');
  // titlePath = ['', project, file, …describes, title]; drop everything that is not the test's own
  // naming, so a browser project can never leak into the identity.
  const titlePath = input.titlePath
    .filter(Boolean)
    .filter((part) => part !== input.projectName && !part.endsWith('.ts'));
  const identityKey = specIdentityKey({ specFile, titlePath });
  return { id: input.pinned ?? specTestCaseId({ specFile, titlePath }), identityKey };
}

/** Collects one row per finished test, and the identities needed for collision detection. */
export class CaseRegistry {
  private readonly records: CaseRecord[] = [];
  private readonly registered: RegisteredCase[] = [];

  add(test: TestCase, result: TestResult): void {
    const { id, identityKey } = testCaseIdOf(test);
    const specFile = path.relative(process.cwd(), test.location.file).replace(/\\/g, '/');
    this.registered.push({ id, identityKey, source: `${specFile} › ${test.title}` });
    this.records.push({
      testCaseId: id,
      project: test.parent.project()?.name ?? '',
      spec: path.basename(test.location.file),
      title: test.title,
      status: statusOf(test, result),
      durationMs: result.duration,
      failureReason: result.error?.message?.split('\n')[0],
    });
  }

  /**
   * Fills in what only a validation report knows: the execution id of the matching result, the
   * endpoint and the validator. Matched by the stable id, which both sides derive identically.
   */
  enrichFromValidationReports(reports: readonly ValidationReport[]): void {
    const byId = new Map<string, { validationId: string; endpoint: string; validator: string }>();
    for (const report of reports) {
      for (const result of report.results) {
        const id =
          result.testCaseId ??
          apiTestCaseId({
            suiteId: report.suite,
            endpointId: result.endpointId,
            validatorName: result.validatorName,
          });
        byId.set(id, {
          validationId: result.validationId,
          endpoint: result.endpoint,
          validator: result.validatorName,
        });
      }
    }
    for (const record of this.records) {
      const match = byId.get(record.testCaseId);
      if (!match) continue;
      record.validationId = match.validationId;
      record.endpoint = match.endpoint;
      record.validator = match.validator;
    }
  }

  /** Two different definitions that would be reported as one case. Never resolved silently. */
  collisions(): TestCaseIdCollision[] {
    return detectCollisions(this.registered);
  }

  all(): readonly CaseRecord[] {
    return this.records;
  }

  /** JSON Lines: one self-contained record per line, appendable and diff-friendly. */
  toJsonl(): string {
    return this.records.map((record) => JSON.stringify(record)).join('\n');
  }
}
