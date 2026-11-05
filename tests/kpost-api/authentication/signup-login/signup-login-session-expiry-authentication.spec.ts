import { AUTH_PROFILES } from '@config/auth-profile';
import { expect, test } from '@fixtures';
import { decodeJwt, jwtSubject } from '@utils/jwt';

/**
 * Server-side session expiry (RTM-SEC02), read-only via `getActiveSession`. A token lives exactly 24 h
 * from issue (no idle timeout). Checks: the live token works; expired, exp-extended and back-dated
 * tokens are refused.
 */
const K = AUTH_PROFILES.kpost.principals;
const A = K.find((p) => p.key === 'personal')!;
const QA_ACCOUNTS = new Set(K.map((p) => p.username.toLowerCase()));

/** The same token with its payload's `exp` replaced — the original signature is kept. */
function withExp(token: string, exp: number): string {
  const [header, payload, signature] = token.split('.') as [string, string, string];
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  const edited = Buffer.from(JSON.stringify({ ...claims, exp }), 'utf8').toString('base64url');
  return `${header}.${edited}.${signature}`;
}

test.describe(
  'KPost sessions · server-side expiry cannot be bypassed',
  {
    tag: ['@api', '@auth', '@regression'],
    annotation: [
      { type: 'requirement', description: 'RTM-SEC02' },
      { type: 'non-functional', description: 'security' },
    ],
  },
  () => {
    test('expired, extended and back-dated tokens are refused while the live token works', async ({
      endpoints,
    }) => {
      const read = (label: string, header?: string) =>
        endpoints.sendTo(
          'signup-login-active-session',
          {},
          {
            label: `session-expiry:${label}`,
            auth: header ? { header } : { principal: A },
          },
        );

      // 1) Control: the live token is accepted — without it a refusal below proves nothing.
      const live = await read('live');
      expect(live.status, 'control: the live token reads the caller’s own sessions').toBe(200);
      const authHeader =
        Object.entries(live.request.headers).find(
          ([k]) => k.toLowerCase() === 'authorization',
        )?.[1] ?? '';
      const [scheme, token] = authHeader.split(' ') as [string, string];
      const claims = decodeJwt(token ?? '')?.payload;
      const exp = claims?.exp;
      expect(typeof exp, 'the live token carries an exp').toBe('number');
      expect(
        Number(exp) - Number(claims?.iat),
        'the token expires exactly 24 hours (86 400 s) after it was issued',
      ).toBe(86_400);

      // 3) exp pushed 30 days out, original signature: must be refused (signature no longer matches).
      const extended = await read(
        'extended-exp',
        `${scheme} ${withExp(token, Number(exp) + 30 * 86_400)}`,
      );
      expect(
        extended.status,
        `a token whose exp was edited to extend the session is refused (got ${extended.status})`,
      ).toBe(401);

      // 4) exp moved into the past: refused (as expired or as tampered — either way not accepted).
      const backdated = await read(
        'backdated-exp',
        `${scheme} ${withExp(token, Math.floor(Date.now() / 1000) - 3_600)}`,
      );
      expect(
        backdated.status,
        `a token whose exp was edited into the past is refused (got ${backdated.status})`,
      ).toBe(401);

      // 2) A genuinely expired token — only one minted for a QA account (never a real person's).
      const expired = await endpoints.expiredToken();
      const subject = expired ? jwtSubject(expired)?.toLowerCase() : undefined;
      const expiredAt = expired ? Number(decodeJwt(expired)?.payload.exp ?? 0) : 0;
      if (!expired || !subject || !QA_ACCOUNTS.has(subject) || expiredAt * 1000 > Date.now()) {
        test.info().annotations.push({
          type: 'skipped-check',
          description:
            'genuinely-expired token check NOT run: no QA-account token in the token history has ' +
            `aged past its exp yet (have: ${subject ?? 'none'})`,
        });
        return;
      }
      const old = await read('expired', `${scheme} ${expired}`);
      test.info().annotations.push({
        type: 'observed',
        description: `expired token (${subject}, exp ${new Date(expiredAt * 1000).toISOString()}): HTTP ${old.status} ${old.bodyText.slice(0, 120)}`,
      });
      expect(old.status, 'a genuinely expired token is refused').toBe(401);
    });
  },
);
