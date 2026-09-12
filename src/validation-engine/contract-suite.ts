import { apiRegistry } from '@api/definitions/index';
import type { EndpointFilter } from '@api/registry/api-registry';
import type { ValidationProfile } from '@config/constants';
import { expect, test } from '@fixtures';
import { formatReport } from '@reporting/report-formatter';
import { ProductionSafetyError } from './production-guard';
import { resolveEndpoint, type ResolvedEndpoint } from './validation-policy';

function tagsFor(endpoint: ResolvedEndpoint): string[] {
  return [
    '@api',
    ...endpoint.tags.map((tag) => `@${tag}`),
    ...(endpoint.destructive ? ['@destructive'] : []),
  ];
}

/**
 * Generates one Playwright test per registered endpoint matching `filter`. Each test runs the
 * central validation engine — spec files describe WHICH endpoints are tested, never HOW.
 */
export function describeEndpointContracts(
  filter: EndpointFilter,
  options: { profile?: ValidationProfile } = {},
): void {
  const endpoints = apiRegistry.find(filter).map(resolveEndpoint);
  if (!endpoints.length) throw new Error(`No registered endpoints match ${JSON.stringify(filter)}`);

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
