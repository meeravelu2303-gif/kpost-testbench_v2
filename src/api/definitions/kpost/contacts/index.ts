import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { contactsReadApis } from './read.api';
import { contactsWriteApis } from './write.api';

/**
 * The KPost **Contacts** module — the address book. `/v2/contacts/*`.
 *
 * The messaging, calling, group and mail modules all act on contacts, so this is the shared
 * counterparty layer under them. Undocumented (no FR ids); contracts from the workbook, payloads
 * from the live client.
 *
 *   read.api.ts   contacts / groups / imported / blocked / search   (all run on live)
 *   write.api.ts  add / delete / reference / block / import / invite (gated lifecycle)
 *
 * **Scope on live:** the reads run on our own account; the account-targeting writes run through the
 * gated feature flow between our own accounts, self-restoring. There is no standalone `/contacts`
 * screen — the contact list/search lives inside the Katchup and Kall screens, already asserted there.
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
