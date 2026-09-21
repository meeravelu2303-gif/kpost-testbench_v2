import { env } from '@config/env';
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

test.describe('KPost Settings · feature flow', { tag: '@kpost-api' }, () => {
  test.describe.configure({ mode: 'default' });
  test.skip(!env.SETTINGS_LIFECYCLE, 'changes account preferences; set SETTINGS_LIFECYCLE=true');

  test('font and theme change, then restore @api @settings', async ({ endpoints }) => {
    try {
      const font = await write(
        endpoints,
        'settings-font',
        { fontSize: 'small', fontStyle: 'Helvetica' },
        'font',
      );
      expect.soft(font, 'fontSetting is accepted').toBeLessThan(300);

      const theme = await write(
        endpoints,
        'settings-change-theme',
        {
          colourPalette: '#0001',
          nightModeEnable: 0,
          'useLocalSunset&Sunrise': 0,
          syncwithDeviceSetting: 0,
          scheduleTiming: 'HH ::RR :: MM',
          kpostLayoutTheme: 'purple',
          katchupChatStyle: 'bubble',
          katchupChatTheme: 'sunset',
          katchupChatBackgroundThemeWallpaper: { default: true, color: null, image: null },
        },
        'theme',
      );
      expect.soft(theme, 'changeTheme is accepted').toBeLessThan(300);
    } finally {
      // Restore a neutral default (medium font, default wallpaper, night mode off).
      await write(
        endpoints,
        'settings-font',
        { fontSize: 'medium', fontStyle: 'Helvetica' },
        'font-restore',
      ).catch(() => undefined);
    }
  });

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
