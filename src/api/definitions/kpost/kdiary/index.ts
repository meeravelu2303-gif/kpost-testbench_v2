import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { kdiaryReadApis } from './read.api';
import { kdiaryWriteApis } from './write.api';

/**
 * The KPost **KDiary** module — `/dairySchedule/*`, the caller's own diary schedules, events,
 * participants and reports.
 *
 *   read.api.ts   today's schedules / all events / today's report / events-by-date  (run on live)
 *   write.api.ts  create / update / delete / participants / remarks / reports        (gated lifecycle)
 *
 * Undocumented (no FR ids; not in the five BRD/PRD/FRD documents). There is no standalone `/kdiary`
 * route today (commented out in `MenuRoutes.js`); the diary is reached from inside Katchup, so there
 * is no separate screen spec.
 */
export const kdiaryApis: EndpointDefinition[] = [...kdiaryReadApis, ...kdiaryWriteApis];

/** Documented `/dairySchedule` paths that no definition covers. Asserted by the coverage spec. */
export function uncoveredKdiaryPaths(): string[] {
  const covered = new Set(
    kdiaryApis.flatMap((api) => [
      `${api.method} ${api.path}`,
      ...(api.contractPath ? [`${api.method} ${api.contractPath}`] : []),
    ]),
  );
  return contractPaths('kpost-api')
    .filter((path) => /^\/(v2\/)?dairySchedule\//i.test(path))
    .filter((path) => ![...covered].some((key) => key.endsWith(` ${path}`)));
}
