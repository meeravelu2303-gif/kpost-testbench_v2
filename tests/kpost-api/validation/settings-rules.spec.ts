import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Settings input and state rules the engine's per-field cases do not reach (its request schemas
 * mark every field optional and never send an empty root body), read from the KPost backend
 * (KPOST_V5.0, com.webservice.kpost):
 * - GeneralSettingController.java:128-133, 175-180, 222-227 — the three notification writes refuse
 *   an empty body with 400.
 * - GeneralSettingServiceImpl.java:143-146, 204-207, 265-268 — "Do Not Disturb" is required; without
 *   it the service returns FAILURE, which the controller answers as 400 (Controller.java:142-154,
 *   189-202, 236-249).
 * - GeneralSettingServiceImpl.java:131-148 (and 192-209, 253-270) + 306-312 — the four preferences
 *   sent are written to that module's own column only (updateKatchupNotification /
 *   updateKmailNotification / updateKallNotification) and read back by getAllNotification.
 * - GeneralSettingController.java:32-49, 61-80 have no empty-body check, and
 *   GeneralSettingServiceImpl.java:33-36, 66-79 then overwrite the stored font / theme with nulls.
 * - GeneralSettingController.java:71 answers changeTheme with the saved theme
 *   (`generalSettingRepo.save(..).getTheme()`, Impl.java:79), which getPersonalize reads back
 *   (Impl.java:109-110).
 * Each test reads the caller's settings first and puts them back in a `finally`. They run as
 * personal-5, the account the Settings endpoints already sign in as (settings-endpoint.ts), so the
 * primary account's preferences are never touched. Gated behind `SETTINGS_LIFECYCLE=true`.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal-5')!;

type Row = Record<string, unknown>;
type Module = 'katchup' | 'kmail' | 'kall';
const MODULES: readonly Module[] = ['katchup', 'kmail', 'kall'];
const endpointOf = (m: Module) => `settings-${m}-notification`;
const PREF_KEYS = ['Message Preview', 'Sound', 'Vibrate', 'Do Not Disturb'] as const;

/** A stored JSON column (object or JSON string) as an object; undefined when unreadable or empty. */
function asObject(value: unknown): Row | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Row;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Row)
      : undefined;
  } catch {
    return undefined;
  }
}

function bodyOf(ex: { json(): { ok: boolean; value?: unknown } }): Row {
  const parsed = ex.json();
  return (parsed.ok ? parsed.value : {}) as Row;
}

async function write(
  endpoints: EndpointExecutor,
  id: string,
  body: unknown,
  label: string,
): Promise<{ status: number; body: Row }> {
  const ex = await endpoints.sendTo(
    id,
    { body },
    { label: `settings-rules:${label}`, auth: { principal: A }, allowLiveWrite: true },
  );
  return { status: ex.status, body: bodyOf(ex) };
}

/** The caller's three notification preferences, as getAllNotification answers them. */
async function notifications(
  endpoints: EndpointExecutor,
  label: string,
): Promise<Partial<Record<Module, Row>>> {
  const ex = await endpoints.sendTo(
    'settings-get-notifications',
    {},
    { label: `settings-rules:${label}`, auth: { principal: A } },
  );
  const data = (bodyOf(ex).data ?? {}) as Row;
  const out: Partial<Record<Module, Row>> = {};
  for (const m of MODULES) {
    const pref = asObject(data[`${m}Notification`]);
    if (pref) out[m] = pref;
  }
  return out;
}

/** The caller's font and theme, as getPersonalize answers them. */
async function personalize(
  endpoints: EndpointExecutor,
  label: string,
): Promise<{ font?: Row; theme?: Row }> {
  const ex = await endpoints.sendTo(
    'settings-get-personalize',
    {},
    { label: `settings-rules:${label}`, auth: { principal: A } },
  );
  const data = (bodyOf(ex).data ?? {}) as Row;
  return { font: asObject(data.fontSettings), theme: asObject(data.changeTheme) };
}

/** A stored preference is restorable only if it carries "Do Not Disturb" (the one required key). */
const restorable = (pref: Row | undefined): pref is Row =>
  typeof pref?.['Do Not Disturb'] === 'string' && pref['Do Not Disturb'] !== '';

/** The four keys of a stored preference, as the request body that stores exactly them again. */
const prefBody = (pref: Row): Row => Object.fromEntries(PREF_KEYS.map((k) => [k, pref[k] ?? '']));

/** Every preference flipped On↔Off, so a write is guaranteed to differ from what is stored. */
const flipped = (pref: Row): Row =>
  Object.fromEntries(PREF_KEYS.map((k) => [k, pref[k] === 'On' ? 'Off' : 'On']));

/** Key order is the server's, not meaning: compare with keys sorted at every level. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value as Row)
        .sort()
        .map((k) => [k, canonical((value as Row)[k])]),
    );
  return value ?? null;
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const prefsEqual = (a: Row | undefined, b: Row | undefined) =>
  !!a && !!b && PREF_KEYS.every((k) => (a[k] ?? '') === (b[k] ?? ''));

/** Puts back every module whose preference no longer matches the original. */
async function restoreNotifications(
  endpoints: EndpointExecutor,
  original: Partial<Record<Module, Row>>,
): Promise<void> {
  const now: Partial<Record<Module, Row>> = await notifications(endpoints, 'restore-check').catch(
    () => ({}),
  );
  for (const m of MODULES) {
    const was = original[m];
    if (!restorable(was) || prefsEqual(was, now[m])) continue;
    const back = await write(endpoints, endpointOf(m), prefBody(was), `restore-${m}`).catch(() => ({
      status: 0,
      body: {},
    }));
    expect.soft(back.status, `the ${m} notification preference is restored`).toBe(200);
  }
}

/** The stored font as the fontSetting body that stores it again. */
const fontBody = (font: Row): Row => ({
  fontSize: font['Font Size'],
  fontStyle: font['Font Style'],
});

/** The stored theme (display keys, Impl.java:67-75) as the changeTheme body that stores it again. */
const themeBody = (theme: Row): Row => ({
  colourPalette: theme['Colour Palette'],
  nightModeEnable: theme['Night Mode Enable'],
  'useLocalSunset&Sunrise': theme['Use Local Sunset & Sunrise'],
  syncwithDeviceSetting: theme['Sync with Device Setting'],
  scheduleTiming: theme['Schedule Timing'],
  kpostLayoutTheme: theme.kpostLayoutTheme,
  katchupChatStyle: theme.katchupChatStyle,
  katchupChatTheme: theme.katchupChatTheme,
  katchupChatBackgroundThemeWallpaper: theme.katchupChatBackgroundThemeWallpaper,
});

test.describe(
  'KPost Settings · input and state rules',
  { tag: ['@api', '@settings', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default' });
    test.skip(
      process.env.SETTINGS_LIFECYCLE !== 'true',
      'changes account preferences; set SETTINGS_LIFECYCLE=true',
    );
    test.skip(!A?.username, 'needs the personal-5 principal (QA_PERSONAL5)');

    test('a notification preference without "Do Not Disturb" is refused with 400 and nothing changes @api @settings', async ({
      endpoints,
    }) => {
      const original = await notifications(endpoints, 'dnd-before');
      const body = { 'Message Preview': 'Off', Sound: 'Off', Vibrate: 'Off' };
      try {
        for (const m of MODULES) {
          const reply = await write(endpoints, endpointOf(m), body, `${m}-no-dnd`);
          const after = (await notifications(endpoints, `${m}-no-dnd-after`))[m];
          const changed = !same(after, original[m]);
          if (reply.status !== 400 || changed) {
            endpoints.recordBusinessRuleViolation({
              endpointId: endpointOf(m),
              ruleId: `SETTINGS-${m}-notification-dnd-required`,
              rule: `${m}Notification requires "Do Not Disturb" (GeneralSettingServiceImpl returns FAILURE without it, which the controller answers as 400) and must store nothing.`,
              expected: '400 "Invalid request", the stored preference unchanged',
              actual: `HTTP ${reply.status}; the stored ${m} preference ${changed ? `is now ${JSON.stringify(after)}` : 'is unchanged'}`,
              request: { body },
            });
          }
          expect.soft(reply.status, `${m}: a body without "Do Not Disturb" is a 400`).toBe(400);
          expect.soft(changed, `${m}: the stored preference is unchanged`).toBe(false);
        }
      } finally {
        await restoreNotifications(endpoints, original);
      }
    });

    test('an empty notification body is refused with 400 and nothing changes @api @settings', async ({
      endpoints,
    }) => {
      const original = await notifications(endpoints, 'empty-before');
      try {
        for (const m of MODULES) {
          const reply = await write(endpoints, endpointOf(m), {}, `${m}-empty`);
          const after = (await notifications(endpoints, `${m}-empty-after`))[m];
          const changed = !same(after, original[m]);
          if (reply.status !== 400 || changed) {
            endpoints.recordBusinessRuleViolation({
              endpointId: endpointOf(m),
              ruleId: `SETTINGS-${m}-notification-empty-body`,
              rule: `${m}Notification must refuse an empty body with 400 before calling the service (GeneralSettingController's isEmpty(requestMap) check).`,
              expected: '400, the stored preference unchanged',
              actual: `HTTP ${reply.status}; the stored ${m} preference ${changed ? `is now ${JSON.stringify(after)}` : 'is unchanged'}`,
              request: { body: {} },
            });
          }
          expect.soft(reply.status, `${m}: an empty body is a 400`).toBe(400);
          expect.soft(changed, `${m}: the stored preference is unchanged`).toBe(false);
        }
      } finally {
        await restoreNotifications(endpoints, original);
      }
    });

    test('each notification preference saved is exactly what getAllNotification reads back @api @settings', async ({
      endpoints,
    }) => {
      const original = await notifications(endpoints, 'readback-before');
      const modules = MODULES.filter((m) => restorable(original[m]));
      test.skip(
        modules.length === 0,
        'no notification preference with "Do Not Disturb" is stored, so none could be restored',
      );
      try {
        for (const m of modules) {
          const sent = flipped(original[m]!);
          const reply = await write(endpoints, endpointOf(m), sent, `${m}-flip`);
          const stored = (await notifications(endpoints, `${m}-flip-after`))[m];
          const matches = prefsEqual(stored, sent);
          if (reply.status === 200 && !matches) {
            endpoints.recordBusinessRuleViolation({
              endpointId: endpointOf(m),
              ruleId: `SETTINGS-${m}-notification-read-back`,
              rule: `${m}Notification must store the four preferences sent, and getAllNotification must read back exactly those values.`,
              expected: JSON.stringify(sent),
              actual: `HTTP ${reply.status} "Updated Successfully", but getAllNotification reads ${JSON.stringify(stored)}`,
              request: { body: sent },
            });
          }
          expect.soft(reply.status, `${m}: the flipped preference is accepted`).toBe(200);
          expect.soft(stored, `${m}: getAllNotification reads back what was saved`).toEqual(sent);
        }
      } finally {
        await restoreNotifications(endpoints, original);
      }
    });

    test("saving one module's notification preference leaves the other two unchanged @api @settings", async ({
      endpoints,
    }) => {
      const original = await notifications(endpoints, 'isolation-before');
      const modules = MODULES.filter((m) => restorable(original[m]));
      test.skip(
        modules.length === 0,
        'no notification preference with "Do Not Disturb" is stored, so none could be restored',
      );
      try {
        for (const m of modules) {
          const before = await notifications(endpoints, `${m}-isolation-before`);
          const sent = flipped(before[m] ?? original[m]!);
          const reply = await write(endpoints, endpointOf(m), sent, `${m}-isolation`);
          const after = await notifications(endpoints, `${m}-isolation-after`);
          // Put this module back before the next, so each write starts from the original state.
          await write(endpoints, endpointOf(m), prefBody(original[m]!), `${m}-isolation-back`);
          for (const other of MODULES.filter((o) => o !== m)) {
            const changed = !same(after[other], before[other]);
            if (changed) {
              endpoints.recordBusinessRuleViolation({
                endpointId: endpointOf(m),
                ruleId: `SETTINGS-${m}-notification-touches-${other}`,
                rule: `${m}Notification must write only the ${m}_notification column; the ${other} preference must not change.`,
                expected: `${other} stays ${JSON.stringify(before[other] ?? null)}`,
                actual: `HTTP ${reply.status}; ${other} is now ${JSON.stringify(after[other] ?? null)}`,
                request: { body: sent },
              });
            }
            expect.soft(changed, `saving ${m} leaves ${other} unchanged`).toBe(false);
          }
        }
      } finally {
        await restoreNotifications(endpoints, original);
      }
    });

    test('an empty fontSetting body is refused and does not erase the stored font @api @settings', async ({
      endpoints,
    }) => {
      const { font } = await personalize(endpoints, 'font-before');
      test.skip(
        !font || typeof font['Font Size'] !== 'string',
        'the caller has no stored font to restore afterwards',
      );
      try {
        const reply = await write(endpoints, 'settings-font', {}, 'font-empty');
        const after = (await personalize(endpoints, 'font-empty-after')).font;
        const erased = !same(after, font);
        if (reply.status < 400 || erased) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'settings-font',
            ruleId: 'SETTINGS-font-empty-body',
            rule: 'fontSetting must refuse an empty body, as the notification writes do (GeneralSettingController isEmpty(requestMap) check); it has no check, and GeneralSettingServiceImpl.fontSetting then saves "Font Size"/"Font Style" as null, erasing the user\'s font.',
            expected: 'a 4xx, the stored font unchanged',
            actual: `HTTP ${reply.status}; the stored font ${erased ? `is now ${JSON.stringify(after ?? null)} (was ${JSON.stringify(font)})` : 'is unchanged'}`,
            request: { body: {} },
          });
        }
        expect.soft(reply.status, 'an empty font body is refused').toBeGreaterThanOrEqual(400);
        expect.soft(erased, 'the stored font is unchanged').toBe(false);
      } finally {
        const now = (await personalize(endpoints, 'font-restore-check').catch(() => ({}))) as {
          font?: Row;
        };
        if (!same(now.font, font)) {
          const back = await write(endpoints, 'settings-font', fontBody(font!), 'font-restore');
          expect.soft(back.status, 'the stored font is restored').toBe(200);
        }
      }
    });

    test('an empty changeTheme body is refused and does not erase the stored theme @api @settings', async ({
      endpoints,
    }) => {
      const { theme } = await personalize(endpoints, 'theme-before');
      test.skip(
        !theme || !('kpostLayoutTheme' in theme),
        'the caller has no stored theme to restore',
      );
      try {
        const reply = await write(endpoints, 'settings-change-theme', {}, 'theme-empty');
        const after = (await personalize(endpoints, 'theme-empty-after')).theme;
        const erased = !same(after, theme);
        if (reply.status < 400 || erased) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'settings-change-theme',
            ruleId: 'SETTINGS-theme-empty-body',
            rule: "changeTheme must refuse an empty body, as the notification writes do (GeneralSettingController isEmpty(requestMap) check); it has no check, and GeneralSettingServiceImpl.changeTheme then saves all nine theme keys as null, erasing the user's theme.",
            expected: 'a 4xx, the stored theme unchanged',
            actual: `HTTP ${reply.status}; the stored theme ${erased ? `is now ${JSON.stringify(after ?? null)}` : 'is unchanged'}`,
            request: { body: {} },
          });
        }
        expect.soft(reply.status, 'an empty theme body is refused').toBeGreaterThanOrEqual(400);
        expect.soft(erased, 'the stored theme is unchanged').toBe(false);
      } finally {
        const now = (await personalize(endpoints, 'theme-restore-check').catch(() => ({}))) as {
          theme?: Row;
        };
        if (!same(now.theme, theme)) {
          const back = await write(
            endpoints,
            'settings-change-theme',
            themeBody(theme!),
            'theme-restore',
          );
          expect.soft(back.status, 'the stored theme is restored').toBe(200);
        }
      }
    });

    test('changeTheme answers with exactly the theme getPersonalize then reads back @api @settings', async ({
      endpoints,
    }) => {
      const { theme } = await personalize(endpoints, 'echo-before');
      test.skip(
        !theme || !('kpostLayoutTheme' in theme),
        'the caller has no stored theme to restore',
      );
      // The live client's own payload (write.api.ts), with a palette that differs from the stored one.
      const sent = {
        ...themeBody(theme!),
        colourPalette: theme!['Colour Palette'] === '#0003' ? '#0004' : '#0003',
      };
      try {
        const reply = await write(endpoints, 'settings-change-theme', sent, 'theme-echo');
        const answered = asObject(reply.body.changeTheme);
        const stored = (await personalize(endpoints, 'theme-echo-after')).theme;
        const matches = !!answered && same(answered, stored);
        if (reply.status === 200 && !matches) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'settings-change-theme',
            ruleId: 'SETTINGS-theme-response-matches-stored',
            rule: 'changeTheme answers with the theme it saved (`changeTheme` in the response), and getPersonalize must read back that same theme.',
            expected: `getPersonalize's changeTheme equals the response's: ${JSON.stringify(answered ?? null)}`,
            actual: `getPersonalize reads ${JSON.stringify(stored ?? null)}`,
            request: { body: sent },
          });
        }
        expect.soft(reply.status, 'the theme change is accepted').toBe(200);
        expect.soft(answered, 'the response carries the saved theme').toBeDefined();
        expect
          .soft(stored, 'getPersonalize reads back the theme the response named')
          .toEqual(answered);
        expect
          .soft(stored?.['Colour Palette'], 'the new palette is what is stored')
          .toBe(sent.colourPalette);
      } finally {
        const now = (await personalize(endpoints, 'echo-restore-check').catch(() => ({}))) as {
          theme?: Row;
        };
        if (!same(now.theme, theme)) {
          const back = await write(
            endpoints,
            'settings-change-theme',
            themeBody(theme!),
            'echo-restore',
          );
          expect.soft(back.status, 'the stored theme is restored').toBe(200);
        }
      }
    });
  },
);
