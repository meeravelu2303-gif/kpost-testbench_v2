import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { settingsReadApis } from './read.api';
import { settingsWriteApis } from './write.api';

/**
 * The KPost **Settings** module — `/generalSetting/*`, the caller's own preferences.
 *
 *   read.api.ts   getPersonalize, getAllNotification            (run on live)
 *   write.api.ts  font, theme, katchup/kmail/kall notifications (gated lifecycle, self-restoring)
 *
 * Undocumented (no FR ids). The `/settings` screen is exercised by `tests/e2e/settings.spec.ts`.
 */
export const settingsApis: EndpointDefinition[] = [...settingsReadApis, ...settingsWriteApis];

/** Documented `/generalSetting` paths that no definition covers. Asserted by the coverage spec. */
export function uncoveredSettingsPaths(): string[] {
  const covered = new Set(
    settingsApis.flatMap((api) => [
      `${api.method} ${api.path}`,
      ...(api.contractPath ? [`${api.method} ${api.contractPath}`] : []),
    ]),
  );
  return contractPaths('kpost-api')
    .filter((path) => /^\/(v2\/)?generalSetting\//i.test(path))
    .filter((path) => ![...covered].some((key) => key.endsWith(` ${path}`)));
}
