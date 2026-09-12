import type { ValidationContext } from '@engine/validation-context';

export function requiresRoleCheck(context: ValidationContext): true | string {
  if (!context.endpoint.authentication.required) return 'endpoint is public';
  return context.endpoint.authorization.roles.length ? true : 'endpoint has no role restrictions';
}
