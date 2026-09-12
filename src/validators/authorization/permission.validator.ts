import { ROLES } from '@config/auth.config';
import { runProbes, type ProbeCase } from '@engine/probe';
import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';
import { requiresRoleCheck } from './support';

export const permissionValidator = defineValidator({
  name: 'authorization.permission',
  category: 'AUTHORIZATION',
  severity: 'CRITICAL',
  description: 'Roles without permission are denied',
  toggle: 'authorization',
  profiles: PROFILE_SETS.DEEP_AND_SECURITY,
  stage: 'probe',
  appliesTo: requiresRoleCheck,
  check: (context) => {
    const denied = ROLES.filter((role) => !context.endpoint.authorization.roles.includes(role));
    if (!denied.length) return outcome.skipped('every role is allowed');
    const cases: ProbeCase[] = denied.flatMap((role) => {
      const principal = context.principal(role);
      return principal
        ? [
            {
              name: role,
              spec: context.request,
              auth: { principal },
              expectedStatus: context.endpoint.authorization.deniedStatus,
            },
          ]
        : [];
    });
    return cases.length
      ? runProbes(context, 'authorization.permission', cases, 'denied-role cases')
      : outcome.skipped('no principals configured for the denied roles');
  },
});
