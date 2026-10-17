import { AUTH_PROFILES } from '@config/auth-profile';
import { expect, test } from '@fixtures';
import { decodeJwt, jwtSubject } from '@utils/jwt';

/**
 * Server-side session expiry (RTM-SEC02): a session ends when the server says so, not when the
 * client feels like it — and the client cannot talk its way past that.
 *
 * What the server actually enforces (KPOST_V5.0 `config/filter/AuthenticationFilter.java`, read
 * 2026-10-15): every protected call needs (a) a JWT that verifies against the server's signing key
 * and is not past its `exp` ("Token has expired" → 401), and (b) a still-active device session row
 * for that token (`loginSessionRepository.getDeviceLoginIDs`) — so logout revokes server-side
 * (BR-SL-LOGOUT, login-flow / login-token-security).
 *
 * Lifetime rule (owner, Meera 2026-10-16): a token is valid for exactly 24 h from issue, whether it is
 * used or not, and then expires on its own. There is no separate idle timeout, and none is required.
 *
 * Checked read-only, on the caller's own session list (`getActiveSession`, which takes the account
 * from the token):
 *   1. control — the bench's live token for qatest1 is accepted, and expires exactly 24 h after issue;
 *   2. a genuinely EXPIRED token (the bench's own token history — a QA account's token minted on an
 *      earlier run and now past its exp) is refused;
 *   3. the live token with its `exp` pushed 30 days out (signature unchanged) is refused — a session
 *      cannot be extended by editing the token;
 *   4. the live token with its `exp` moved into the past is refused.
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
      // The requirement (owner, 2026-10-16): a token is valid for exactly 24 hours from issue, used or
      // not — it expires on its own; there is no separate idle timeout.
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
