import { z } from 'zod';
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
  /**
   * The login endpoint to authenticate this principal at, overriding the auth profile's default.
   * BUSINESS_M/L admins log in via `adminUserLogin` (Medium/Large enterprise login), not `userLogin`
   * — the same token then works on the Admin module. Absent for ordinary accounts.
   */
  loginEndpointId: z.string().min(1).optional(),
});
export type Principal = z.infer<typeof PrincipalSchema>;

/**
 * Generic `AUTH_PRINCIPALS` (JSON) principals. KPost's own accounts come from the `QA_*` values via
 * `auth-profile.ts`; this list only matters when a run supplies explicit principals.
 */
function loadPrincipals(): readonly Principal[] {
  if (!env.AUTH_PRINCIPALS) return [];
  const source: unknown = JSON.parse(env.AUTH_PRINCIPALS);
  const parsed = z.array(PrincipalSchema).safeParse(source);
  if (!parsed.success)
    throw new Error(`Invalid AUTH_PRINCIPALS:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

const principals = loadPrincipals();

export const authConfig = {
  roles: ROLES,
  principals,
  /** Tenant (company) that tests create data in. */
  testTenantId: env.TEST_COMPANY_ID ?? principals.find((p) => p.role === 'COMPANY_ADMIN')?.tenantId,

  /** How a token travels: `Authorization: Bearer <token>`. The login itself is the auth profile's. */
  scheme: 'Bearer',

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
