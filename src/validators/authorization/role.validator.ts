import { runProbes, type ProbeCase } from '@engine/probe';
import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';
import { requiresRoleCheck } from './support';

export const roleValidator = defineValidator({
  name: 'authorization.role',
  category: 'AUTHORIZATION',
  severity: 'HIGH',
  description: 'Every allowed role can call the endpoint successfully',
  toggle: 'authorization',
  profiles: PROFILE_SETS.DEEP,
  stage: 'probe',
  appliesTo: requiresRoleCheck,
  check: async (context) => {
    const cases: ProbeCase[] = [];
    for (const role of context.endpoint.authorization.roles) {
      const principal = context.principal(role);
      if (!principal) continue;
      cases.push({
        name: role,
        spec: await context.nextRequest(),
        auth: { principal },
        expectedStatus: context.endpoint.expectedStatus,
      });
    }
    return cases.length
      ? runProbes(context, 'authorization.role', cases, 'allowed-role cases')
      : outcome.skipped('no principals configured for the allowed roles');
  },
});
