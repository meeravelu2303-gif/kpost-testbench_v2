import { contractPaths } from '../../../contract/workbook-contract';
import { dashboardApis } from './dashboard.api';

/** The KPost Dashboard module — `/v2/dashboard/*`, the Home recent-messages panel. */
export { dashboardApis };

/** Documented `/dashboard` paths no definition covers. Asserted by the dashboard coverage spec. */
export function uncoveredDashboardPaths(): string[] {
  const covered = new Set(dashboardApis.map((api) => `${api.method} ${api.path}`));
  return contractPaths('kpost-api')
    .filter((path) => /^\/(v2\/)?dashboard\//i.test(path))
    .filter((path) => ![...covered].some((key) => key.endsWith(` ${path}`)));
}
