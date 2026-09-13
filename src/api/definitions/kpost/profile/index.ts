import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { profileDeviceApis } from './device.api';
import { profileImageApis } from './image.api';
import { profileReadApis } from './read.api';
import { profileWriteApis } from './write.api';

/**
 * The KPost **Profile** module — `/v2/profile/*`. The account owner's own profile: details, search,
 * education/experience, images, privacy, device designation and account security.
 *
 * **Undocumented.** None of the five documents describe Profile, so these definitions carry no FR
 * ids; their contracts come from the workbook and the live web client (`KPOST_REACTJS_2023_V1`).
 *
 *   read.api.ts    fetch, search, digital card, languages, downloads   (live-safe)
 *   write.api.ts   about, designation, basic, contact, privacy, education, share
 *   image.api.ts   profile / cover / signature / attachment uploads
 *   device.api.ts  primary/secondary device (OTP-gated), password, deactivate
 */
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
