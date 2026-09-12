import { apiRegistry } from '@api/definitions/index';
import type { EndpointFilter } from '@api/registry/api-registry';
import type { ValidationProfile } from '@config/constants';
import { expect, test } from '@fixtures';
import { formatReport } from '@reporting/report-formatter';
import { ProductionSafetyError } from './production-guard';
import { resolveEndpoint, type ResolvedEndpoint } from './validation-policy';

function tagsFor(endpoint: ResolvedEndpoint): string[] {
  // The module tag (e.g. @kmail-api) lets one command run exactly one module's contracts.
  return [
    '@api',
    `@${endpoint.suite.id}`,
    ...endpoint.tags.map((tag) => `@${tag.replace(/\s+/g, '-')}`),
    ...(endpoint.destructive ? ['@destructive'] : []),
  ];
}

/**
 * Generates one Playwright test per registered endpoint matching `filter`. Each test runs the
 * central validation engine — spec files describe WHICH endpoints are tested, never HOW.
 */
export function describeEndpointContracts(
  filter: EndpointFilter,
  options: { profile?: ValidationProfile; allowEmpty?: boolean } = {},
): void {
  const endpoints = apiRegistry.find(filter).map(resolveEndpoint);
  if (!endpoints.length) {
    // A module whose host is not configured registers no endpoints — a skip, not a typo.
    if (options.allowEmpty) {
      test.skip(`no endpoints registered for ${JSON.stringify(filter)}`, () => {});
      return;
    }
    throw new Error(`No registered endpoints match ${JSON.stringify(filter)}`);
  }

  for (const endpoint of endpoints) {
    test(
      `${endpoint.label} [${endpoint.id}]`,
      { tag: tagsFor(endpoint) },
      async ({ validationEngine }) => {
        try {
          const report = await validationEngine.validate(endpoint.definition, options);
          expect(report.gate.blocking, formatReport(report)).toEqual([]);
        } catch (error) {
          if (error instanceof ProductionSafetyError) test.skip(true, error.message);
          throw error;
        }
      },
    );
  }
}
