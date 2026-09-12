import { runProbes } from '@engine/probe';
import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';
import { deepMerge } from '@utils/json';

export const privilegeEscalationValidator = defineValidator({
  name: 'authorization.privilege-escalation',
  category: 'AUTHORIZATION',
  severity: 'CRITICAL',
  description: 'A lower-privileged role cannot grant itself or others higher privileges',
  toggle: 'authorization',
  profiles: PROFILE_SETS.DEEP_AND_SECURITY,
  stage: 'probe',
  appliesTo: ({ endpoint }) =>
    endpoint.authorization.privilegeEscalation
      ? true
      : 'no privilege-escalation scenario configured',
  check: async (context) => {
    const scenario = context.endpoint.authorization.privilegeEscalation;
    const principal = scenario ? context.principal(scenario.role) : undefined;
    if (!scenario || !principal)
      return outcome.skipped('no principal configured for the escalation role');
    return runProbes(
      context,
      'authorization.privilege-escalation',
      [
        {
          name: `${scenario.role} escalation attempt`,
          spec: deepMerge(await context.nextRequest(), scenario.overrides),
          auth: { principal },
          expectedStatus: scenario.expectedStatus ?? context.endpoint.authorization.deniedStatus,
        },
      ],
      'privilege-escalation cases',
    );
  },
});
