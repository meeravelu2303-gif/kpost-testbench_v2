import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { groupApis } from './group.api';

/**
 * The KPost **Group** module — `/v2/group/*`. Groups underpin Katchup group messaging (FR-K06):
 * `createUserGroup` mints a `groupKpostID` used as the receiver for a group send. See group.api.ts.
 */
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
