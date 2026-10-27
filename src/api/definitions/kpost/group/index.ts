import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { groupApis } from './group.api';

/** Group (`/v2/group/*`): groups underpin Katchup group messaging. */
export { groupApis };

/** Documented `/group` paths no definition covers. Asserted by the group coverage spec. */
export function uncoveredGroupPaths(): string[] {
  const covered = new Set(
    groupApis.flatMap((api: EndpointDefinition) => [
      `${api.method} ${api.path}`,
      ...(api.contractPath ? [`${api.method} ${api.contractPath}`] : []),
    ]),
  );
  return contractPaths('kpost-api')
    .filter((path) => /^\/(v2\/)?group\//i.test(path))
    .filter((path) => ![...covered].some((key) => key.endsWith(` ${path}`)));
}
