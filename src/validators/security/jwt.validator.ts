import { authConfig } from '@config/auth.config';
import { PROFILE_SETS, type ResolvedEndpoint } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { fromChecks, type CheckDetail } from '@engine/validation-result';
import { getPath } from '@utils/json';
import { decodeJwt, unsignedJwt } from '@utils/jwt';

const SENSITIVE_CLAIM = /pass|secret|pwd|ssn/i;
const WEAK_ALGORITHMS = new Set(['none', 'NONE', 'None']);

/** The forged-token probe is an authentication check: honour the endpoint's auth policy. */
const probesAuthentication = (endpoint: ResolvedEndpoint): boolean =>
  endpoint.authentication.required && endpoint.validations.authentication;

const check = (name: string, ok: boolean, expected: unknown, actual: unknown): CheckDetail => ({
  name,
  status: ok ? 'PASSED' : 'FAILED',
  expected,
  actual,
});

export const jwtValidator = defineValidator({
  name: 'security.jwt',
  category: 'SECURITY',
  severity: 'HIGH',
  description:
    'Issued JWTs are signed, expiring and free of secrets; unsigned (alg=none) tokens are rejected',
  toggle: 'security',
  profiles: PROFILE_SETS.DEEP_AND_SECURITY,
  stage: 'probe',
  appliesTo: ({ endpoint }) =>
    endpoint.security.tokenResponsePath || probesAuthentication(endpoint)
      ? true
      : 'endpoint neither issues a JWT nor has authentication validation enabled',
  check: async (context) => {
    const checks: CheckDetail[] = [];
    const { endpoint, primary } = context;

    if (endpoint.security.tokenResponsePath) {
      const parsed = primary.json();
      const token = parsed.ok
        ? getPath(parsed.value, endpoint.security.tokenResponsePath)
        : undefined;
      const decoded = typeof token === 'string' ? decodeJwt(token) : undefined;
      checks.push(
        check(
          'issued token is a JWT',
          decoded !== undefined,
          'decodable JWT',
          decoded ? 'JWT' : typeof token,
        ),
      );
      if (decoded) {
        const { alg } = decoded.header;
        const { exp, iat } = decoded.payload;
        const now = Date.now() / 1000;
        checks.push(
          check(
            'signed algorithm',
            typeof alg === 'string' && !WEAK_ALGORITHMS.has(alg),
            'not "none"',
            alg,
          ),
          check('exp in the future', typeof exp === 'number' && exp > now, '> now', exp),
          check(
            'lifetime within limit',
            typeof exp === 'number' &&
              typeof iat === 'number' &&
              exp - iat <= authConfig.maxTokenLifetimeSeconds,
            `<= ${authConfig.maxTokenLifetimeSeconds}s`,
            typeof exp === 'number' && typeof iat === 'number' ? exp - iat : 'exp/iat missing',
          ),
          check(
            'no sensitive claims',
            !Object.keys(decoded.payload).some((k) => SENSITIVE_CLAIM.test(k)),
            'none',
            Object.keys(decoded.payload),
          ),
        );
      }
    }

    if (probesAuthentication(endpoint)) {
      const principal = context.principal(endpoint.authentication.role);
      const decoded = principal ? decodeJwt(await context.tokenFor(principal)) : undefined;
      if (decoded) {
        const forged = unsignedJwt({ ...decoded.payload, role: 'SUPER_ADMIN' });
        const exchange = await context.send(context.request, {
          label: 'security.jwt:alg-none',
          auth: { header: `${authConfig.scheme} ${forged}` },
        });
        const expected = endpoint.authentication.failureStatus.invalid;
        checks.push({
          ...check(
            'unsigned alg=none token rejected',
            expected.includes(exchange.status),
            expected,
            exchange.status,
          ),
          correlationId: exchange.correlationId,
        });
      }
    }
    return fromChecks(checks, 'JWT checks');
  },
});
