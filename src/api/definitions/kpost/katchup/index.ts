import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { katchupAttachmentApis } from './attachments.api';
import { katchupManageApis } from './manage.api';
import { katchupReadApis } from './read.api';
import { katchupSendApis } from './send.api';

/**
 * The KPost **Katchup** module — instant messaging. `/v2/katchup/*`.
 *
 * FR-K01..K25 and BR-K01..K03. Grouped by what an endpoint does, because that is how it fails and
 * how it is gated for the live application:
 *
 *   read.api.ts        counts, conversations, search, shares, read receipts   (mostly live-safe)
 *   send.api.ts        create a message: 1:1, multipart, bulk                 (writes — owner sign-off)
 *   manage.api.ts      recall, delete, mark, report, forward                  (need a real msgID)
 *   attachments.api.ts download / thumbnail / stream / generate              (need a real uuid)
 *
 * The message-type/status/share-type codes and the send contract are analysed in
 * `docs/katchup-flow.md`; the codes come from `@api/schemas/kpost-types`.
 *
 * **Scope on live today:** two PERSONAL accounts, so the no-write reads run, group / Cc /
 * confidential-copy / bulk wait on more accounts, and every send waits on the owner's sign-off.
 * `docs/LIVE-ENDPOINTS.md` shows the per-endpoint status.
 */
export const katchupApis: EndpointDefinition[] = [
  ...katchupReadApis,
  ...katchupSendApis,
  ...katchupManageApis,
  ...katchupAttachmentApis,
];

/**
 * Documented `/katchup` paths that no definition covers.
 *
 * Asserted by tests/api/kpost/katchup/coverage.spec.ts, so a future workbook dump that adds an
 * endpoint here fails the run instead of being quietly untested. Both the live path and any
 * `contractPath` count as covered, so a corrected route does not read as a miss.
 */
export function uncoveredKatchupPaths(): string[] {
  const covered = new Set(
    katchupApis.flatMap((api) => [
      `${api.method} ${api.path}`,
      ...(api.contractPath ? [`${api.method} ${api.contractPath}`] : []),
    ]),
  );
  return contractPaths('kpost-api')
    .filter((path) => /^\/(v2\/)?katchup\//i.test(path))
    .filter((path) => ![...covered].some((key) => key.endsWith(` ${path}`)));
}
