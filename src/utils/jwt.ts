import { isPlainObject, type JsonObject } from './json';

export interface DecodedJwt {
  header: JsonObject;
  payload: JsonObject;
  signature: string;
}

const base64UrlJson = (value: JsonObject): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

/** Decodes without verifying — the test bench never holds signing keys. */
export function decodeJwt(token: string): DecodedJwt | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [header, payload, signature] = parts as [string, string, string];
  try {
    const decodedHeader: unknown = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    const decodedPayload: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!isPlainObject(decodedHeader) || !isPlainObject(decodedPayload)) return undefined;
    return { header: decodedHeader, payload: decodedPayload, signature };
  } catch {
    return undefined;
  }
}

/** Expiry of a JWT in epoch milliseconds, when present. */
export function jwtExpiry(token: string): number | undefined {
  const exp = decodeJwt(token)?.payload.exp;
  return typeof exp === 'number' ? exp * 1000 : undefined;
}

/** The token's subject claim — for KPost, the kpostID it was issued to. */
export function jwtSubject(token: string): string | undefined {
  const sub = decodeJwt(token)?.payload.sub;
  return typeof sub === 'string' ? sub : undefined;
}

/** Same header and claims, broken signature — a well-formed but invalid token. */
export function tamperSignature(token: string): string {
  const [header = '', payload = '', signature = ''] = token.split('.');
  const flipped = signature.startsWith('A') ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
  return `${header}.${payload}.${flipped}`;
}

/** Unsigned token (`alg: none`) carrying the given claims — must always be rejected. */
export function unsignedJwt(payload: JsonObject): string {
  return `${base64UrlJson({ alg: 'none', typ: 'JWT' })}.${base64UrlJson(payload)}.`;
}
