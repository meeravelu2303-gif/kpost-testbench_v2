import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { kdiaryReadApis } from './read.api';
import { kdiaryWriteApis } from './write.api';

/** KDiary (`/dairySchedule/*`): reads run on live; writes go through the gated lifecycle. */
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
