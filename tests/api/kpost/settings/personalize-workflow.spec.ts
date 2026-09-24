import { requireAll } from '@fixtures/test-accounts';
import { expect, test } from '@fixtures';

/**
 * Personalization (font + theme) — change → persist → read back, asserted on the caller's settings
 * row. Mirrors `notifications-workflow.spec.ts`'s pattern for the same table.
 *
 * `generalSetting/*` answers SUCCESS whatever it wrote, so persistence is checked against
 * `TBL_KPOST_GENERAL_SETTINGS.font` / `.theme` directly, not just the response envelope. And
 * `getPersonalize` (`settings-get-personalize`) is checked against that same row, not against what
 * the test just sent — an endpoint serving a cached or default value instead of the stored row would
 * otherwise pass unnoticed.
 *
 * Writes only to the caller's own settings row, captures the original value and restores it exactly
 * — both font AND theme. `feature.spec.ts`'s theme test restored only font; the live QA account was
 * found still holding that test's theme values (kpostLayoutTheme: "purple", Colour Palette: "#0001")
 * from a prior run, confirming the gap. Fixed there too.
 */
test.describe('KPost Settings · personalize (font/theme) @api @kpost-api @settings @database', () => {
  test.describe.configure({ mode: 'serial' });

  const accounts = requireAll('primary');
  test.skip(!accounts.ok, accounts.ok ? '' : accounts.reason);

  const me = (): string => (accounts.ok ? (accounts.accounts[0]?.kpostId ?? '') : '');

  /** The row as we found it, so the account is left exactly as it started. */
  let original: { font?: unknown; theme?: unknown } | undefined;

  test('the caller has a settings row with font and theme columns', async ({ databases }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    const row = await database.findOne<{ font: unknown; theme: unknown }>({
      table: 'TBL_KPOST_GENERAL_SETTINGS',
      where: { kpost_id: me() },
    });
    expect(row, 'the settings row exists').toBeDefined();
    original = { font: row?.font, theme: row?.theme };
  });

  test('changing the font persists to the settings row, and getPersonalize reflects it', async ({
    endpoints,
    databases,
  }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    const write = await endpoints.sendTo(
      'settings-font',
      { body: { fontSize: 'large', fontStyle: 'Arial' } },
      { label: 'personalize-workflow:font-change', allowLiveWrite: true },
    );
    const parsed = write.json();
    const envelope = parsed.ok ? (parsed.value as { statusCode?: number }) : {};
    expect(
      envelope.statusCode ?? write.status,
      `the font change reported failure (body: ${write.bodyText.slice(0, 160)})`,
    ).toBeLessThan(300);

    const afterWrite = await database.findOne<{ font: unknown }>({
      table: 'TBL_KPOST_GENERAL_SETTINGS',
      where: { kpost_id: me() },
    });
    expect(
      JSON.stringify(afterWrite?.font ?? null),
      'the stored font changed when the write was applied',
    ).not.toBe(JSON.stringify(original?.font ?? null));

    const readBack = await endpoints.sendTo(
      'settings-get-personalize',
      {},
      { label: 'personalize-workflow:read-back-font' },
    );
    expect(readBack.status, 'getPersonalize succeeds').toBe(200);
    const body = JSON.parse(readBack.bodyText || '{}') as {
      data?: { fontSettings?: Record<string, unknown> };
    };
    expect(
      body.data?.fontSettings,
      'getPersonalize reflects the exact stored font row, not a cached/default value',
    ).toEqual(afterWrite?.font);
  });

  test('changing the theme persists to the settings row, and getPersonalize reflects it', async ({
    endpoints,
    databases,
  }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    const write = await endpoints.sendTo(
      'settings-change-theme',
      {
        body: {
          colourPalette: '#0002',
          nightModeEnable: 1,
          'useLocalSunset&Sunrise': 0,
          syncwithDeviceSetting: 0,
          scheduleTiming: 'HH ::RR :: MM',
          kpostLayoutTheme: 'blue',
          katchupChatStyle: 'classic',
          katchupChatTheme: 'default',
          katchupChatBackgroundThemeWallpaper: { default: true, color: null, image: null },
        },
      },
      { label: 'personalize-workflow:theme-change', allowLiveWrite: true },
    );
    const parsed = write.json();
    const envelope = parsed.ok ? (parsed.value as { statusCode?: number }) : {};
    expect(
      envelope.statusCode ?? write.status,
      `the theme change reported failure (body: ${write.bodyText.slice(0, 160)})`,
    ).toBeLessThan(300);

    const afterWrite = await database.findOne<{ theme: unknown }>({
      table: 'TBL_KPOST_GENERAL_SETTINGS',
      where: { kpost_id: me() },
    });
    expect(
      JSON.stringify(afterWrite?.theme ?? null),
      'the stored theme changed when the write was applied',
    ).not.toBe(JSON.stringify(original?.theme ?? null));

    const readBack = await endpoints.sendTo(
      'settings-get-personalize',
      {},
      { label: 'personalize-workflow:read-back-theme' },
    );
    expect(readBack.status, 'getPersonalize succeeds').toBe(200);
    const body = JSON.parse(readBack.bodyText || '{}') as {
      data?: { changeTheme?: Record<string, unknown> };
    };
    expect(
      body.data?.changeTheme,
      'getPersonalize reflects the exact stored theme row, not a cached/default value',
    ).toEqual(afterWrite?.theme);
  });

  test.afterAll(async ({ endpoints }) => {
    // Restore BOTH font and theme to what this account actually had before this spec ran — not a
    // guessed default. Leaving the theme changed on a shared QA account silently changes what any
    // other test or human sees on it next.
    if (!accounts.ok || !original) return;
    const font = original.font as { 'Font Size'?: string; 'Font Style'?: string } | undefined;
    const theme = original.theme as
      | {
          'Colour Palette'?: string;
          'Night Mode Enable'?: number;
          'Use Local Sunset & Sunrise'?: number;
          'Sync with Device Setting'?: number;
          'Schedule Timing'?: string;
          kpostLayoutTheme?: string;
          katchupChatStyle?: string;
          katchupChatTheme?: string;
          katchupChatBackgroundThemeWallpaper?: unknown;
        }
      | undefined;
    if (font) {
      await endpoints
        .sendTo(
          'settings-font',
          { body: { fontSize: font['Font Size'], fontStyle: font['Font Style'] } },
          { label: 'personalize-workflow:font-restore', allowLiveWrite: true },
        )
        .catch(() => undefined);
    }
    if (theme) {
      await endpoints
        .sendTo(
          'settings-change-theme',
          {
            body: {
              colourPalette: theme['Colour Palette'],
              nightModeEnable: theme['Night Mode Enable'],
              'useLocalSunset&Sunrise': theme['Use Local Sunset & Sunrise'],
              syncwithDeviceSetting: theme['Sync with Device Setting'],
              scheduleTiming: theme['Schedule Timing'],
              kpostLayoutTheme: theme.kpostLayoutTheme,
              katchupChatStyle: theme.katchupChatStyle,
              katchupChatTheme: theme.katchupChatTheme,
              katchupChatBackgroundThemeWallpaper: theme.katchupChatBackgroundThemeWallpaper,
            },
          },
          { label: 'personalize-workflow:theme-restore', allowLiveWrite: true },
        )
        .catch(() => undefined);
    }
  });
});
