import { authConfig } from '@config/auth.config';
import { runProbes } from '@engine/probe';
import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';

export const expiredTokenValidator = defineValidator({
  name: 'authentication.expired-token',
  category: 'AUTHENTICATION',
  severity: 'HIGH',
  description: 'An expired token is rejected',
  toggle: 'authentication',
  profiles: PROFILE_SETS.DEEP_AND_SECURITY,
  stage: 'probe',
  appliesTo: ({ endpoint }) => (endpoint.authentication.required ? true : 'endpoint is public'),
  check: async (context) => {
    const token = await context.expiredToken();
    if (!token)
      return outcome.skipped('no expired token available for this environment (set EXPIRED_TOKEN)');
    return runProbes(
      context,
      'authentication.expired-token',
      [
        {
          name: 'expired token',
          spec: context.request,
          auth: { header: `${authConfig.scheme} ${token}` },
          expectedStatus: context.endpoint.authentication.failureStatus.expired,
        },
      ],
      'expired-token cases',
    );
  },
});
