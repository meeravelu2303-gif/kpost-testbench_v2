import { apiRegistry } from '@api/definitions/index';
import type { EndpointFilter } from '@api/registry/api-registry';
import type { ValidationProfile } from '@config/constants';
import { env } from '@config/env';
import { describeTestData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { formatReport } from '@reporting/report-formatter';
import { apiTestCaseId, TEST_CASE_ID_ANNOTATION } from '@reporting/test-case-id';
import { validationRegistry } from '@validators/index';
import { ProductionSafetyError } from './production-guard';
import { resolveEndpoint, type ResolvedEndpoint } from './validation-policy';
import type { ValidationReport, ValidationResult } from './validation-result';
import { STAGE_ORDER } from './validator';

/**
 * Reports every central validation as its own Playwright test case.
 *
 * `describeEndpointContracts` gives one test per endpoint: right for a CI gate, poor as a report —
 * "POST /v2/common/sendOTP/ failed" does not say what failed. This gives a named case per
 * validation, so a run reads like a test plan:
 *
 *     POST /v2/common/sendOTP/
 *       ✓ response.status-code — the primary response status is one of the expected statuses
 *       ✓ response.schema — payload conforms to the endpoint's response schema
 *       ✗ security.security-headers — x-content-type-options missing
 *       - authentication.missing-token — endpoint is public (skipped, with the reason)
 *
 * The *content* of each case still belongs entirely to the central validators. Registering a new
 * validator adds a case to every endpoint automatically; no spec file changes.
 *
 * ## One HTTP run per endpoint, not one per case
 *
 * The engine executes once per endpoint and each case asserts its own slice of the report. That is
 * a correctness requirement, not an optimisation: these endpoints send SMS and email, so running
 * the engine per case would send a message per case per run.
 *
 * The project runs `fullyParallel`, which would scatter cases across workers and defeat that, so
 * each endpoint's block is pinned to one worker with `mode: 'default'` — sequential, but *not*
 * `serial`, whose "first failure skips the rest" would hide the very detail this exists to show.
 */
export interface EndpointCaseOptions {
  profile?: ValidationProfile;
  /** A module whose host is not configured registers nothing; skip rather than fail. */
  allowEmpty?: boolean;
}

/** One engine run per endpoint id, shared by that endpoint's cases. */
const runs = new Map<string, Promise<ValidationReport | ProductionSafetyError>>();

interface PlannedCase {
  name: string;
  description: string;
  /**
   * Set when the case is reported but deliberately not executed — today, a validator outside the
   * active validation profile. It still appears (SKIPPED, with this reason) so a run can never
   * silently lose a whole class of checks: "injection not run" must be visible in the report.
   */
  skipReason?: string;
}

/**
 * The validations that will be reported for an endpoint, derived without sending anything.
 *
 * Validators the policy excludes are deliberately **kept**: they become skipped cases carrying the
 * reason ("endpoint is public", "no request schema"), which documents the endpoint's shape far
 * better than silently omitting them. The same holds for validators outside the active validation
 * profile: they are planned with a `skipReason` instead of being dropped, so a REGRESSION run shows
 * injection/XSS as "not in profile" rather than not at all. Business rules and database validations
 * are named the way the engine names them, so their results line up.
 */
export function plannedCases(
  endpoint: ResolvedEndpoint,
  profile?: ValidationProfile,
): PlannedCase[] {
  const active = profile ?? env.VALIDATION_PROFILE;
  const central = validationRegistry
    .all()
    .sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage])
    .map((validator): PlannedCase => {
      const planned: PlannedCase = { name: validator.name, description: validator.description };
      if (!validator.profiles.includes(active)) {
        planned.skipReason =
          `not in validation profile ${active} (runs in ${validator.profiles.join('/')}) — ` +
          'set VALIDATION_PROFILE to include it';
      }
      return planned;
    });

  return [
    ...central,
    ...endpoint.businessRules.map((id) => ({
      name: `business-rule.${id}`,
      description: `business rule "${id}"`,
    })),
    ...endpoint.databaseValidations.map((id) => ({
      name: `database.${id}`,
      description: `database validation "${id}"`,
    })),
  ];
}

function tagsFor(endpoint: ResolvedEndpoint): string[] {
  return [
    '@api',
    `@${endpoint.suite.id}`,
    ...endpoint.tags.map((tag) => `@${tag.replace(/\s+/g, '-')}`),
    ...(endpoint.destructive ? ['@destructive'] : []),
  ];
}

function resultFor(report: ValidationReport, name: string): ValidationResult | undefined {
  return report.results.find((result) => result.validatorName === name);
}

export function describeEndpointCases(
  filter: EndpointFilter,
  options: EndpointCaseOptions = {},
): void {
  const endpoints = apiRegistry.find(filter).map(resolveEndpoint);
  if (!endpoints.length) {
    if (options.allowEmpty) {
      test.skip(`no endpoints registered for ${JSON.stringify(filter)}`, () => {});
      return;
    }
    throw new Error(`No registered endpoints match ${JSON.stringify(filter)}`);
  }

  for (const endpoint of endpoints) {
    test.describe(`${endpoint.label} [${endpoint.id}]`, () => {
      // Keep this endpoint's cases in one worker so they share its single engine run.
      test.describe.configure({ mode: 'default' });

      for (const planned of plannedCases(endpoint, options.profile)) {
        test(
          `${planned.name} — ${planned.description}`,
          { tag: tagsFor(endpoint) },
          async ({ validationEngine }) => {
            /*
             * The case's STABLE identity, recorded as an annotation so it reaches the Playwright
             * report and the case registry even when the engine produced no result (a skip). It is
             * the same id `buildResult` puts on every ValidationResult — derived, never generated.
             */
            test.info().annotations.push({
              type: TEST_CASE_ID_ANNOTATION,
              description: apiTestCaseId({
                suiteId: endpoint.suite.id,
                endpointId: endpoint.id,
                validatorName: planned.name,
              }),
            });
            if (planned.skipReason) {
              test.skip(true, planned.skipReason);
              return;
            }
            const note = describeTestData();
            if (note) test.info().annotations.push({ type: 'test-data', description: note });

            let run = runs.get(endpoint.id);
            if (!run) {
              run = validationEngine
                .validate(endpoint.definition, options)
                .catch((error: unknown) => {
                  if (error instanceof ProductionSafetyError) return error;
                  throw error instanceof Error ? error : new Error(String(error));
                });
              runs.set(endpoint.id, run);
            }

            const report = await run;
            if (report instanceof ProductionSafetyError) {
              test.skip(true, report.message);
              return;
            }

            const result = resultFor(report, planned.name);
            /*
             * Planned but absent means the engine never reached it, because a prerequisite failed.
             * Saying which prerequisite is more useful than a bare "not run".
             */
            if (!result) {
              const blocking = report.gate.blocking.join(', ');
              test.skip(
                true,
                `not executed — prerequisite failed${blocking ? `: ${blocking}` : ''}`,
              );
              return;
            }
            if (result.status === 'SKIPPED') {
              test.skip(true, result.message);
              return;
            }

            expect(result.status, `${result.message}\n\n${formatReport(report)}`).not.toBe(
              'FAILED',
            );
          },
        );
      }
    });
  }
}
