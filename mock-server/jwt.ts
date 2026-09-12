import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Minimal HS256 JWT for the mock API. The key is random per process unless MOCK_JWT_SECRET is set. */
const SECRET = process.env.MOCK_JWT_SECRET ?? randomBytes(32).toString('hex');

export interface Claims {
  sub: string;
  role: string;
  tenantId?: string;
  iat: number;
  exp: number;
  iss: string;
}

const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = (data: string): string =>
  createHmac('sha256', SECRET).update(data).digest('base64url');

export function signToken(claims: Claims): string {
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  return `${unsigned}.${sign(unsigned)}`;
}

function decodePart(part: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Returns the claims, `'expired'`, or undefined for anything invalid (incl. alg=none). */
export function verifyToken(token: string): Claims | 'expired' | undefined {
  const [header, payload, signature, ...rest] = token.split('.');
  if (!header || !payload || !signature || rest.length) return undefined;
  if (decodePart(header)?.alg !== 'HS256') return undefined;

  const expected = Buffer.from(sign(`${header}.${payload}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;

  const claims = decodePart(payload) as Claims | undefined;
  if (!claims || typeof claims.exp !== 'number') return undefined;
  return claims.exp <= Math.floor(Date.now() / 1000) ? 'expired' : claims;
}
