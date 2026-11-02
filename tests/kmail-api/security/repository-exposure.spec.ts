import { AUTH_PROFILES } from '@config/auth-profile';
import { env } from '@config/env';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { expect, test } from '@fixtures';

/**
 * The KMail service must not publish its database tables over HTTP. Spring Data REST exports every
 * repository at the service root (outside /v2) unless it is disabled; with any user's token,
 * /users, /loginSessions, /kmailContents and /katchupMessageses then list every account, session,
 * mail body and chat message (#13380). Read-only: only key names and paging totals are read, and no
 * write method is ever tried on these paths.
 */
const K = AUTH_PROFILES.kpost;
const ANY_USER = K.principals.find((p) => p.key === 'personal-3')!;
const ROOT = (env.KMAIL_API_BASE_URL ?? '').replace(/\/+$/, '');
const REPOSITORIES = ['profile', 'users', 'loginSessions', 'kmailContents', 'katchupMessageses'];

test.describe(
  'KMail · no database repository is reachable over HTTP @api @kmail-api @kmail @security',
  {
    tag: ['@api', '@kmail', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
    test.skip(!ROOT, 'needs the KMail host (KMAIL_API_BASE_URL)');

    test('a signed-in user gets 404 for the repository paths at the KMail root', async ({
      endpoints,
      request,
    }) => {
      const token = await endpoints.tokens.tokenFor(ANY_USER, K);
      const exposed: string[] = [];
      for (const repo of REPOSITORIES) {
        const res = await request.get(`${ROOT}/${repo}?size=1`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/hal+json' },
          failOnStatusCode: false,
        });
        if (res.status() >= 300) continue;
        // Only the shape is recorded: never the values.
        const json = (await res.json().catch(() => ({}))) as {
          page?: { totalElements?: number };
          _links?: Record<string, unknown>;
        };
        const what =
          repo === 'profile'
            ? `${Object.keys(json._links ?? {}).length - 1} repositories listed`
            : `${json.page?.totalElements ?? '?'} records`;
        exposed.push(`/${repo} → ${res.status()} (${what})`);
      }
      expect
        .soft(
          exposed,
          'database repositories must not be readable over HTTP by any signed-in user (#13380)',
        )
        .toEqual([]);
    });
  },
);
