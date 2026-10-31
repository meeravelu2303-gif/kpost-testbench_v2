import { expect, test } from '@fixtures';
import { flowState } from '../../support/flow-state';
import { settingsCallerKpostId } from '../../support/settings-caller';

/**
 * Personalization (font + theme): change, persist, read back, checked against
 * `TBL_KPOST_GENERAL_SETTINGS` (the API says SUCCESS regardless). Restores both font and theme.
 */
test.describe(
  'KPost Settings · personalize (font/theme) @api @kpost-api @settings @database',
  { tag: ['@api', '@settings', '@regression'] },
  () => {
    // In order, but a failed step never skips the others.
    test.describe.configure({ mode: 'default' });

    // The row of the account the Settings endpoints sign in as.
    const caller = settingsCallerKpostId();
    test.skip(!caller, 'needs the account the Settings endpoints sign in as (QA_PERSONAL5)');

    const me = (): string => caller ?? '';

    /** The row as we found it (on disk, so a restore after a failed step still has it). */
    const flow = flowState<{ original: { font?: unknown; theme?: unknown } }>(
      'personalize-workflow',
    );

    test.afterAll(async ({ endpoints }) => {
      // Restore both font and theme to the captured values: the QA account is shared.
      const original = flow.get('original');
      if (!caller || !original) return;
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

    test('the caller has a settings row with font and theme columns', async ({ databases }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');

      const row = await database.findOne<{ font: unknown; theme: unknown }>({
        table: 'TBL_KPOST_GENERAL_SETTINGS',
        where: { kpost_id: me() },
      });
      expect(row, 'the settings row exists').toBeDefined();
      // Captured once per run: a later worker must not take an already-changed row as the original.
      if (!flow.get('original')) flow.set('original', { font: row?.font, theme: row?.theme });
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
      ).not.toBe(JSON.stringify(flow.get('original')?.font ?? null));

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
      ).not.toBe(JSON.stringify(flow.get('original')?.theme ?? null));

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
  },
);
