import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { kosReadApis } from './read.api';
import { kosWriteApis } from './write.api';

/**
 * The KPost **KOS** module — the office suite. `/kword/*` (KWord documents) and `/ai/*` (K-AI).
 *
 *   read.api.ts   document list + AI sessions (live); doc/session-keyed reads (needs-doc-id)
 *   write.api.ts  KWord CRUD + share/join/exit/convert (gated lifecycle); AI generation (metered)
 *
 * Undocumented (no FR ids). The KOS screen renders "Coming Soon" today, so this module is API-only.
 * The two AI generation endpoints (`chatResponse`, `messageAssist`) call a real metered AI service,
 * so they are `external` and stay blocked until the owner authorizes the spend.
 */
export const kosApis: EndpointDefinition[] = [...kosReadApis, ...kosWriteApis];

/** Documented `/kword` and `/ai` paths that no definition covers. Asserted by the coverage spec. */
export function uncoveredKosPaths(): string[] {
  const covered = new Set(
    kosApis.flatMap((api) => [
      `${api.method} ${api.path}`,
      ...(api.contractPath ? [`${api.method} ${api.contractPath}`] : []),
    ]),
  );
  return contractPaths('kpost-api')
    .filter((path) => /^\/(kword|ai)\//i.test(path))
    .filter((path) => ![...covered].some((key) => key.endsWith(` ${path}`)));
}
