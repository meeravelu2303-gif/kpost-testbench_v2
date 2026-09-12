import { randomBytes } from 'node:crypto';
import { authConfig } from '@config/auth.config';
import { runProbes } from '@engine/probe';
import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';
import { tamperSignature } from '@utils/jwt';

const HOUR_SECONDS = 3_600;

function foreignSignedToken(): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + HOUR_SECONDS;
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'intruder', role: 'SUPER_ADMIN', exp })}.${randomBytes(32).toString('base64url')}`;
}

export const invalidTokenValidator = defineValidator({
  name: 'authentication.invalid-token',
  category: 'AUTHENTICATION',
  severity: 'CRITICAL',
  description: 'Well-formed tokens with an invalid signature are rejected',
  toggle: 'authentication',
  profiles: PROFILE_SETS.DEEP_AND_SECURITY,
  stage: 'probe',
  appliesTo: ({ endpoint }) => (endpoint.authentication.required ? true : 'endpoint is public'),
  check: async (context) => {
    const principal = context.principal(context.endpoint.authentication.role);
    if (!principal)
      return outcome.skipped(
        `no principal configured for role ${context.endpoint.authentication.role}`,
      );
    const validToken = await context.tokenFor(principal);
    const expectedStatus = context.endpoint.authentication.failureStatus.invalid;
    return runProbes(
      context,
      'authentication.invalid-token',
      [
        {
          name: 'tampered signature',
          spec: context.request,
          auth: { header: `${authConfig.scheme} ${tamperSignature(validToken)}` },
          expectedStatus,
        },
        {
          name: 'token signed with foreign key',
          spec: context.request,
          auth: { header: `${authConfig.scheme} ${foreignSignedToken()}` },
          expectedStatus,
        },
      ],
      'invalid-token cases',
    );
  },
});
