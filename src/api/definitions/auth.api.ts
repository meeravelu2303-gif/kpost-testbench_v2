import { randomUUID } from 'node:crypto';
import { authConfig, principalFor } from '@config/auth.config';
import type { EndpointDefinition } from '../registry/endpoint-definition';
import { loginRequestSchema, loginResponseSchema } from '../schemas/auth.schema';

/** Login is validated with a dedicated principal so its negative probes never lock real accounts. */
const LOGIN_PROBE_PRINCIPAL_KEY = 'login-probe';
const LOGIN_RATE_LIMIT = 10;

function loginProbeCredentials() {
  const principal =
    authConfig.principals.find((p) => p.key === LOGIN_PROBE_PRINCIPAL_KEY) ??
    principalFor(authConfig.defaultRole);
  if (!principal) throw new Error('No principal available to validate the login endpoint');
  return authConfig.loginRequest(principal);
}

export const loginApi: EndpointDefinition = {
  id: 'auth-login',
  method: 'POST',
  path: '/auth/login',
  summary: 'Exchange credentials for an access token',
  tags: ['auth', 'critical'],
  expectedStatus: [200],
  authentication: { required: false },
  destructive: false,
  request: loginProbeCredentials,
  requestSchema: loginRequestSchema,
  responseSchema: loginResponseSchema,
  security: {
    sensitiveFieldAllowlist: ['accessToken'],
    tokenResponsePath: authConfig.tokenPath,
    injectionMustBeRejected: true,
    rateLimit: {
      maxRequests: LOGIN_RATE_LIMIT,
      request: () => ({
        body: {
          username: `rate-limit-probe-${randomUUID()}@kpost.test`,
          password: `invalid-${randomUUID()}`,
        },
      }),
    },
  },
};
