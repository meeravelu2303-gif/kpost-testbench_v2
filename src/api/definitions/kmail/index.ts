import { contractPaths } from '../../contract/workbook-contract';
import type { EndpointDefinition } from '../../registry/endpoint-definition';
import { kmailReadApis } from './read.api';
import { kmailSendApis } from './send.api';
import { kmailDraftApis } from './draft.api';
import { kmailManageApis } from './manage.api';
import { kmailSettingsApis } from './settings.api';

/**
 * KMail (`kmail-api`): reads run live; sends, drafts, manage and settings writes are gated. See
 * `docs/modules/kmail-flow.md`.
 */
export const kmailApis: EndpointDefinition[] = [
  ...kmailReadApis,
  ...kmailSendApis,
  ...kmailDraftApis,
  ...kmailManageApis,
  ...kmailSettingsApis,
];

/**
 * Documented KMail paths no definition covers; the AWS presigned-URL path is covered under
 * `kpost-api`.
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
