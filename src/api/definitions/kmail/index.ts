import { contractPaths } from '../../contract/workbook-contract';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { kmailReadApis } from './read.api';
import { kmailSendApis } from './send.api';
import { kmailDraftApis } from './draft.api';
import { kmailManageApis } from './manage.api';
import { kmailSettingsApis } from './settings.api';

/**
 * The KPost **KMail** module — email. Suite `kmail-api`, host `kmail5.kpostindia.com/kmail5/v2`.
 * FR-M01..M09, BR-M01. Codes/flow analysed in `docs/kmail-flow.md`.
 *
 *   read.api.ts     dashboards, counts, lists, subjects, drafts, settings, translation (reads live)
 *   send.api.ts     compose / multipart / bulk                                          (gated)
 *   draft.api.ts    save / multipart / delete drafts                                    (gated)
 *   manage.api.ts   delete / important / status / PDF / external contacts / credentials (gated)
 *   settings.api.ts signature / instant reply / saluations / letterhead / count limit   (gated)
 */
export const kmailApis: EndpointDefinition[] = [
  ...kmailReadApis,
  ...kmailSendApis,
  ...kmailDraftApis,
  ...kmailManageApis,
  ...kmailSettingsApis,
];

/**
 * Documented KMail paths that no definition covers. Asserted by the coverage spec.
 *
 * `/v2/aws/generate-presigned-url` appears in the KMail contract too but is the **AWS** module's
 * endpoint (covered under `kpost-api`), so it is excluded here rather than duplicated.
 */
const COVERED_ELSEWHERE = new Set(['/v2/aws/generate-presigned-url']);

export function uncoveredKmailPaths(): string[] {
  const covered = new Set(
    kmailApis.flatMap((api) => [
      `${api.method} ${api.contractPath ?? api.path}`,
      `${api.method} ${api.path}`,
    ]),
  );
  return contractPaths('kmail-api')
    .filter((path) => !COVERED_ELSEWHERE.has(path))
    .filter((path) => ![...covered].some((key) => key.endsWith(` ${path}`)));
}
