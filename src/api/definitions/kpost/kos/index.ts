import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { kosReadApis } from './read.api';
import { kosWriteApis } from './write.api';

/**
 * KOS (`/kword/*`, `/ai/*`): KWord documents and K-AI. The AI generation endpoints call a metered
 * service.
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
