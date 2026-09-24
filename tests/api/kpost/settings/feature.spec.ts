// An orchestrated settings lifecycle (read → change → restore), not simple assertions.
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Settings **feature flow** — change the caller's own preferences and put them back. These are the
 * safest writes in the bench (cosmetic, own-account, no other user), but they persist, so the flow
 * is gated `SETTINGS_LIFECYCLE=true`, each write `allowLiveWrite`, and restores to a sensible default
 * in a `finally`.
 *
 * The font/theme change test that used to live here moved to `personalize-workflow.spec.ts`: it
 * restored only the font on cleanup, never the theme, and the live QA account was found still
 * holding a prior run's theme values (kpostLayoutTheme: "purple") as a result. The replacement
 * captures the account's real original font AND theme from the database and restores both exactly,
 * and additionally verifies the write persists to `TBL_KPOST_GENERAL_SETTINGS` and that
 * `settings-get-personalize` reflects the stored row rather than a cached/default value.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

async function write(
  endpoints: EndpointExecutor,
  id: string,
  bodyObj: Record<string, unknown>,
  label: string,
): Promise<number> {
  const ex = await endpoints.sendTo(
    id,
    { body: bodyObj },
    { label: `settings:${label}`, auth: { principal: A }, allowLiveWrite: true },
  );
  return ex.status;
}

test.describe('KPost Settings · feature flow', () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    process.env.SETTINGS_LIFECYCLE !== 'true',
    'changes account preferences; set SETTINGS_LIFECYCLE=true',
  );

  test('the three notification toggles are each accepted, then restored on @api @settings', async ({
    endpoints,
  }) => {
    const toggles: Array<[string, string]> = [
      ['settings-katchup-notification', 'katchup'],
      ['settings-kmail-notification', 'kmail'],
      ['settings-kall-notification', 'kall'],
    ];
    try {
      for (const [id, label] of toggles) {
        const off = await write(endpoints, id, { enable: 0 }, `${label}-off`);
        expect.soft(off, `${label} notification toggle is accepted`).toBeLessThan(300);
      }
    } finally {
      // Restore notifications to enabled.
      for (const [id, label] of toggles) {
        await write(endpoints, id, { enable: 1 }, `${label}-restore`).catch(() => undefined);
      }
    }
  });
});
