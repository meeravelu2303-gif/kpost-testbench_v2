import { apiRegistry } from '@api/definitions/index';
import type { EndpointFilter } from '@api/registry/api-registry';
import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import type { ValidationProfile } from '@config/constants';
import { env } from '@config/env';
import { describeTestData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { formatReport } from '@reporting/report-formatter';
import { validationRegistry } from '@validators/index';
import { judgedCheckReason } from '../bug-tracker/gates/known-false-positives';
import { ProductionSafetyError } from './production-guard';
import { resolveEndpoint, type ResolvedEndpoint } from './validation-policy';
import type { ValidationReport, ValidationResult } from './validation-result';
import { STAGE_ORDER } from './validator';

/**
 * Reports each central validation as its own Playwright test case (`<endpoint> › <validator>`). The
 * engine runs once per endpoint and every case asserts its slice, so the endpoint's block is pinned
 * to one worker (`mode: 'default'`, not `serial`, so one failure does not skip the rest).
 */
export interface EndpointCaseOptions {
  profile?: ValidationProfile;
  /** A module whose host is not configured registers nothing; skip rather than fail. */
  allowEmpty?: boolean;
  /** Rewrites each selected definition before it runs (e.g. `withSacrificialTarget` for writes). */
  transform?: (definition: EndpointDefinition) => EndpointDefinition;
}

/** One engine run per endpoint and profile, shared by that endpoint's cases. */
const runs = new Map<string, Promise<ValidationReport | ProductionSafetyError>>();

interface PlannedCase {
  name: string;
  description: string;
}

/**
 * The validations reported for an endpoint, derived without sending anything. Excluded validators
 * stay as skipped cases with their reason.
 */
export function plannedCases(
  endpoint: ResolvedEndpoint,
  profile?: ValidationProfile,
): PlannedCase[] {
  const active = profile ?? env.VALIDATION_PROFILE;
  const central = validationRegistry
    .all()
    .filter((validator) => validator.profiles.includes(active))
    // Concurrency probes fire simultaneous bursts; skip them on a server shared with live (see env).
    .filter((validator) => env.CONCURRENCY_PROBES || validator.category !== 'CONCURRENCY')
    .sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage])
    .map((validator) => ({ name: validator.name, description: validator.description }));

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
  const endpoints = apiRegistry
    .find(filter)
    .map((definition) => options.transform?.(definition) ?? definition)
    .map(resolveEndpoint);
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
            const note = describeTestData();
            if (note) test.info().annotations.push({ type: 'test-data', description: note });

            const runKey = `${endpoint.id}|${options.profile ?? env.VALIDATION_PROFILE}`;
            let run = runs.get(runKey);
            if (!run) {
              run = validationEngine
                .validate(endpoint.definition, options)
                .catch((error: unknown) => {
                  if (error instanceof ProductionSafetyError) return error;
                  throw error instanceof Error ? error : new Error(String(error));
                });
              runs.set(runKey, run);
            }

            const report = await run;
            if (report instanceof ProductionSafetyError) {
              test.skip(true, report.message);
              return;
            }

            const result = resultFor(report, planned.name);
            // Planned but absent: a prerequisite failed, so name it.
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
            // A failure ruled "not a defect" in Bugzilla is skipped with that ruling.
            const judged =
              result.status === 'FAILED'
                ? judgedCheckReason(
                    endpoint.path,
                    planned.name,
                    (result.details ?? []).filter((d) => d.status === 'FAILED'),
                    result.message,
                  )
                : undefined;
            if (judged) {
              test.info().annotations.push({ type: 'judged-not-a-defect', description: judged });
              test.skip(true, judged);
              return;
            }

            // SMOKE: over budget is a WARNING (speed is environmental); no answer still fails.
            if (
              result.status === 'FAILED' &&
              planned.name === 'performance.response-time' &&
              (options.profile ?? env.VALIDATION_PROFILE) === 'SMOKE'
            ) {
              test.info().annotations.push({
                type: 'warning',
                description: `slow (not failed in sanity): ${result.message}`,
              });
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
