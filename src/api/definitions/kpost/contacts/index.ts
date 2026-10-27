import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { contactsReadApis } from './read.api';
import { contactsWriteApis } from './write.api';

/**
 * Contacts (`/v2/contacts/*`): reads run on live; writes go through the gated lifecycle between our
 * own accounts.
 */
export const contactsApis: EndpointDefinition[] = [...contactsReadApis, ...contactsWriteApis];

/** Documented `/contacts` paths that no definition covers. Asserted by the coverage spec. */
export function uncoveredContactsPaths(): string[] {
  const covered = new Set(
    contactsApis.flatMap((api) => [
      `${api.method} ${api.path}`,
      ...(api.contractPath ? [`${api.method} ${api.contractPath}`] : []),
    ]),
  );
  return contractPaths('kpost-api')
    .filter((path) => /^\/(v2\/)?contacts\//i.test(path))
    .filter((path) => ![...covered].some((key) => key.endsWith(` ${path}`)));
}
