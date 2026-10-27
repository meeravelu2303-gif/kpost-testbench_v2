import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { profileDeviceApis } from './device.api';
import { profileImageApis } from './image.api';
import { profileReadApis } from './read.api';
import { profileWriteApis } from './write.api';

/** Profile (`/v2/profile/*`): reads, profile writes, image uploads and device/account security. */
export const profileApis: EndpointDefinition[] = [
  ...profileReadApis,
  ...profileWriteApis,
  ...profileImageApis,
  ...profileDeviceApis,
];

/** Documented `/profile` paths no definition covers. Asserted by the profile coverage spec. */
export function uncoveredProfilePaths(): string[] {
  const covered = new Set(
    profileApis.flatMap((api) => [
      `${api.method} ${api.path}`,
      ...(api.contractPath ? [`${api.method} ${api.contractPath}`] : []),
    ]),
  );
  return contractPaths('kpost-api')
    .filter((path) => /^\/(v2\/)?profile\//i.test(path))
    .filter((path) => ![...covered].some((key) => key.endsWith(` ${path}`)));
}
