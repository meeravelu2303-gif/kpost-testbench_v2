import { authConfig } from '@config/auth.config';
import { runProbes, type ProbeCase } from '@engine/probe';
import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';

/** A tenant-bound principal must not reach another tenant's resources (IDOR / BOLA). */
export const crossResourceAccessValidator = defineValidator({
  name: 'authorization.cross-resource-access',
  category: 'AUTHORIZATION',
  severity: 'CRITICAL',
  description: 'Principals of another tenant cannot access or create resources in this tenant',
  toggle: 'authorization',
  profiles: PROFILE_SETS.DEEP_AND_SECURITY,
  stage: 'probe',
  appliesTo: ({ endpoint }) =>
    endpoint.authorization.tenantScoped ? true : 'endpoint is not tenant-scoped',
  check: async (context) => {
    const cases: ProbeCase[] = [];
    for (const role of context.endpoint.authorization.roles) {
      const owner = context.principal(role);
      const foreign = owner?.tenantId
        ? context.principal(role, { foreignTenantOf: owner.tenantId })
        : undefined;
      if (!foreign) continue;
      cases.push({
        name: `${role} of tenant ${foreign.tenantId ?? '?'}`,
        spec: await context.nextRequest(),
        auth: { principal: foreign },
        expectedStatus: authConfig.crossTenantDeniedStatus,
      });
    }
    return cases.length
      ? runProbes(context, 'authorization.cross-resource-access', cases, 'cross-tenant cases')
      : outcome.skipped('no principals of a second tenant configured');
  },
});
