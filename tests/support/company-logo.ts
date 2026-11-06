import type { APIRequestContext } from '@playwright/test';
import type { ApiResponseWrapper } from '@api/client/response-wrapper';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { restoreStep } from './flow-restore';

/** The QA company whose logo the logo specs change (company 242), and its admin. */
export const LOGO_COMPANY = testData.businessMCompanyId;
export const LOGO_ADMIN: Principal | undefined = AUTH_PROFILES.kpost.principals.find(
  (p) => p.key === 'business-m',
);

/** A 1x1 PNG, generated rather than committed. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+6ZlWAAAAAElFTkSuQmCC',
  'base64',
);

export interface Logo {
  status: number;
  bytes?: Buffer;
  type?: string;
}

export type LogoFile = { name: string; mimeType: string; buffer: Buffer };

/** The logo's bytes as the admin sees them (the executor keeps only text, so this reads raw). */
export async function readLogo(
  endpoints: EndpointExecutor,
  request: APIRequestContext,
): Promise<Logo> {
  const token = await endpoints.tokens.tokenFor(LOGO_ADMIN!, AUTH_PROFILES.kpost);
  const base = env.KPOST_API_BASE_URL ?? env.API_BASE_URL;
  const res = await request.get(`${base}/v2/common/downloadCompanyLogo/${LOGO_COMPANY}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status() === 200
    ? { status: 200, bytes: await res.body(), type: res.headers()['content-type'] }
    : { status: res.status() };
}

/** The read-back equals the original (the same bytes, or still no logo). */
export const sameLogo = (now: Logo, original: Logo): boolean =>
  original.bytes ? now.bytes?.equals(original.bytes) === true : now.status === original.status;

/**
 * Puts the company's own logo back (or none, as it was), logging the admin in again if the shared
 * session was lost. `upload` and `remove` are the caller's own admin calls.
 */
export async function restoreLogo(
  endpoints: EndpointExecutor,
  request: APIRequestContext,
  original: Logo,
  upload: (file: LogoFile, label: string) => Promise<ApiResponseWrapper>,
  remove: (label: string) => Promise<ApiResponseWrapper>,
): Promise<Logo> {
  if (original.bytes) {
    const ext = /jpe?g/.test(original.type ?? '') ? 'jpg' : 'png';
    const buffer = original.bytes;
    await restoreStep(endpoints, LOGO_ADMIN!, () =>
      upload(
        { name: `company-logo.${ext}`, mimeType: original.type ?? 'image/png', buffer },
        'restore',
      ),
    );
  } else if ((await readLogo(endpoints, request)).status !== 404) {
    // 200 (a logo is there) or 401 (the session was lost): remove, logging in again if needed.
    await restoreStep(endpoints, LOGO_ADMIN!, () => remove('restore-none'));
  }
  return readLogo(endpoints, request);
}
