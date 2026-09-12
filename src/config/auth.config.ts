import { z } from 'zod';
import type { RequestSpec } from '@api/client/request-builder';
import mockSeed from '../../mock-server/seed.json';
import { env } from './env';

export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN', 'USER'] as const;
export type Role = (typeof ROLES)[number];

const PrincipalSchema = z.object({
  /** Stable handle, e.g. "admin" or "company-admin-other-tenant". */
  key: z.string().min(1),
  role: z.enum(ROLES),
  tenantId: z.string().optional(),
  username: z.string().min(1),
  password: z.string().min(1),
  /**
   * KPost's user type (PERSONAL, BUSINESS_S/M/L, INSTITUTION_*). The same password authenticates
   * a tiered account only when its tier is sent, so it belongs to the principal.
   */
  userType: z.string().min(1).optional(),
});
export type Principal = z.infer<typeof PrincipalSchema>;

function loadPrincipals(): readonly Principal[] {
  const source: unknown = env.AUTH_PRINCIPALS
    ? JSON.parse(env.AUTH_PRINCIPALS)
    : // Credentials of the local mock API only — real environments must provide AUTH_PRINCIPALS.
      env.MOCK_API
      ? mockSeed.principals
      : [];
  const parsed = z.array(PrincipalSchema).safeParse(source);
  if (!parsed.success)
    throw new Error(`Invalid AUTH_PRINCIPALS:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

const principals = loadPrincipals();

export const authConfig = {
  roles: ROLES,
  principals,
  /** Role used for the primary (happy-path) request when an endpoint does not specify one. */
  defaultRole: 'ADMIN' as Role,
  /** Tenant (company) that tests create data in. */
  testTenantId: env.TEST_COMPANY_ID ?? principals.find((p) => p.role === 'COMPANY_ADMIN')?.tenantId,

  /** Registered endpoint used by the token provider to log in, and how to call it. */
  loginEndpointId: 'auth-login',
  loginRequest: (principal: Principal): RequestSpec => ({
    body: { username: principal.username, password: principal.password },
  }),
  tokenPath: 'data.accessToken',
  scheme: 'Bearer',
  /** Mock-only endpoint that mints an expired token (real envs use EXPIRED_TOKEN). */
  mockExpiredTokenPath: '/__test/tokens/expired',

  /** Expected status per authentication failure mode; endpoints may override. */
  failureStatus: {
    missing: [401],
    invalid: [401],
    expired: [401],
    malformed: [401],
  } as Record<'missing' | 'invalid' | 'expired' | 'malformed', readonly number[]>,
  deniedStatus: [403] as readonly number[],
  /** Some APIs hide foreign resources behind 404 instead of 403 — both are safe. */
  crossTenantDeniedStatus: [403, 404] as readonly number[],
  /** Upper bound for an issued token's lifetime (JWT validator). */
  maxTokenLifetimeSeconds: 24 * 3_600,
} as const;

export function principalFor(
  role: Role,
  options: { foreignTenantOf?: string } = {},
): Principal | undefined {
  return principals.find(
    (p) =>
      p.role === role &&
      (options.foreignTenantOf === undefined ||
        (p.tenantId !== undefined && p.tenantId !== options.foreignTenantOf)),
  );
}
