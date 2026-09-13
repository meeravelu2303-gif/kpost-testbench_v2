import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { kallDirectApis } from './direct.api';
import { kallReadApis } from './read.api';
import { kallScheduleApis } from './schedule.api';

/**
 * The KPost **Kall** module — voice/video calling. `/v2/kall/*`.
 *
 * FR-C01..C09 and BR-C01. Grouped by what an endpoint does, because that is how it fails and how it
 * is gated for the live application:
 *
 *   read.api.ts      call log, today's scheduled, frequent contacts, status   (log reads run live)
 *   direct.api.ts    place a normal call, move its status, end, clear log      (writes — lifecycle)
 *   schedule.api.ts  schedule / reschedule / join / end / repeat / members     (writes — lifecycle)
 *
 * The status / type / mode / repeat-type codes and the flows are analysed in `docs/kall-flow.md`;
 * the codes come from `@api/schemas/kpost-types`.
 *
 * **Scope on live today:** the log reads run on our own account; every write is gated behind
 * `KALL_LIFECYCLE=true` (a call rings a real device / notifies participants), and the two
 * `kallID`-keyed status reads wait on a real call id the lifecycle creates. `docs/LIVE-ENDPOINTS.md`
 * shows the per-endpoint status.
 */
export const kallApis: EndpointDefinition[] = [
  ...kallReadApis,
  ...kallDirectApis,
  ...kallScheduleApis,
];

/**
 * Documented `/kall` paths that no definition covers.
 *
 * Asserted by tests/api/kpost/kall/coverage.spec.ts, so a future workbook dump that adds an endpoint
 * here fails the run instead of being quietly untested. Both the live path and any `contractPath`
 * count as covered.
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
