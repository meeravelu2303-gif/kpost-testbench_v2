import { authProfileFor } from '@config/auth-profile';
import type { Principal, Role } from '@config/auth.config';
import type { ValidationContext } from '@engine/validation-context';

export function requiresRoleCheck(context: ValidationContext): true | string {
  if (!context.endpoint.authentication.required) return 'endpoint is public';
  return context.endpoint.authorization.roles.length ? true : 'endpoint has no role restrictions';
}

/**
 * The account that owns the endpoint's data for `role`: the endpoint's own `principalKey` when it
 * has that role (a business endpoint names its company's admin), else the first principal of the
 * role. Without this, the first COMPANY_ADMIN — not the endpoint's company — would be the owner.
 */
export function ownerPrincipal(context: ValidationContext, role: Role): Principal | undefined {
  const key = context.endpoint.authentication.principalKey;
  const named = key ? authProfileFor().principals.find((p) => p.key === key) : undefined;
  return named?.role === role ? named : context.principal(role);
}
