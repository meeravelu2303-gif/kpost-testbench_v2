import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { kallDirectApis } from './direct.api';
import { kallLegacyApis } from './legacy.api';
import { kallReadApis } from './read.api';
import { kallScheduleApis } from './schedule.api';

/**
 * Kall (`/v2/kall/*`): reads, direct-call and scheduled-call writes (KALL_LIFECYCLE only), and
 * legacy V1 writes still live. See `docs/modules/kall-flow.md`.
 */
export const kallApis: EndpointDefinition[] = [
  ...kallReadApis,
  ...kallDirectApis,
  ...kallScheduleApis,
  ...kallLegacyApis,
];

/**
 * Documented `/kall` paths no definition covers (live path or `contractPath`); asserted by
 * coverage.spec.ts.
 */
export function uncoveredKallPaths(): string[] {
  const covered = new Set(
    kallApis.flatMap((api) => [
      `${api.method} ${api.path}`,
      ...(api.contractPath ? [`${api.method} ${api.contractPath}`] : []),
    ]),
  );
  return contractPaths('kpost-api')
    .filter((path) => /^\/(v2\/)?kall\//i.test(path))
    .filter((path) => ![...covered].some((key) => key.endsWith(` ${path}`)));
}
