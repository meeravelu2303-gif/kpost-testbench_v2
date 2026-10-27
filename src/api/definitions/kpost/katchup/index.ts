import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { katchupAttachmentApis } from './attachments.api';
import { katchupManageApis } from './manage.api';
import { katchupReadApis } from './read.api';
import { katchupSendApis } from './send.api';

/**
 * Katchup (`/v2/katchup/*`), grouped by what an endpoint does: reads, sends, message actions (need
 * a real msgID) and attachments (need a real uuid). See `docs/modules/katchup-flow.md`.
 */
export const katchupApis: EndpointDefinition[] = [
  ...katchupReadApis,
  ...katchupSendApis,
  ...katchupManageApis,
  ...katchupAttachmentApis,
];

/** Documented paths deliberately left undefined (retired); each entry needs its own reason. */
const DELIBERATELY_UNCOVERED: ReadonlySet<string> = new Set([
  // Unused by the client; only forwardKatchupMessageNew is live.
  'POST /v2/katchup/forwardKatchupMessage/',
]);

/**
 * Documented `/katchup` paths no definition covers (live path or `contractPath`); asserted by
 * coverage.spec.ts.
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
    .filter((path) => ![...covered].some((key) => key.endsWith(` ${path}`)))
    .filter((path) => ![...DELIBERATELY_UNCOVERED].some((key) => key.endsWith(` ${path}`)));
}
