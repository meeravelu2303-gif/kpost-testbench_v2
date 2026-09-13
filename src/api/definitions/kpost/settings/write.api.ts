import { body } from '../kpost-endpoint';
import { defineSettingsEndpoint } from './settings-endpoint';

/**
 * Settings **writes** — change font, theme, and the three notification toggles. Each changes only
 * the **caller's own** preferences (no other user, no shared state), so they are the safest writes
 * in the bench — but they still persist a change to our account, so none is `productionSafe`; they
 * run through the gated feature flow (`SETTINGS_LIFECYCLE=true`) with `allowLiveWrite`, self-restoring.
 * Payloads: font/theme from the workbook + live client; the notification toggles document no body,
 * so a minimal `{enable: 1}` is sent and the empty-body/null probes carry the rest.
 */
const WRITE_TAGS = ['settings-write'] as const;

export const fontSettingApi = defineSettingsEndpoint({
  id: 'settings-font',
  method: 'POST',
  path: '/generalSetting/fontSetting',
  summary: "Set the caller's font size and style",
  tags: [...WRITE_TAGS, 'personalize'],
  destructive: true,
  request: body(() => ({ fontSize: 'small', fontStyle: 'Helvetica' })),
});

export const changeThemeApi = defineSettingsEndpoint({
  id: 'settings-change-theme',
  method: 'POST',
  path: '/generalSetting/changeTheme',
  summary: "Change the caller's theme / appearance",
  tags: [...WRITE_TAGS, 'theme'],
  // The live client's full theme payload (Services/ThemeSettings.js). Self-restoring in the flow.
  destructive: true,
  request: body(() => ({
    colourPalette: '#0001',
    nightModeEnable: 1,
    'useLocalSunset&Sunrise': 0,
    syncwithDeviceSetting: 0,
    scheduleTiming: 'HH ::RR :: MM',
    kpostLayoutTheme: 'purple',
    katchupChatStyle: 'bubble',
    katchupChatTheme: 'sunset',
    katchupChatBackgroundThemeWallpaper: { default: true, color: null, image: null },
  })),
});

export const katchupNotificationApi = defineSettingsEndpoint({
  id: 'settings-katchup-notification',
  method: 'POST',
  path: '/generalSetting/katchupNotification',
  summary: 'Toggle Katchup notifications',
  tags: [...WRITE_TAGS, 'notification'],
  destructive: true,
  request: body(() => ({ enable: 1 })),
  note: 'workbook documents no body; toggle shape inferred',
});

export const kmailNotificationApi = defineSettingsEndpoint({
  id: 'settings-kmail-notification',
  method: 'POST',
  path: '/generalSetting/kmailNotification',
  summary: 'Toggle KMail notifications',
  tags: [...WRITE_TAGS, 'notification'],
  destructive: true,
  request: body(() => ({ enable: 1 })),
  note: 'workbook documents no body; toggle shape inferred',
});

export const kallNotificationApi = defineSettingsEndpoint({
  id: 'settings-kall-notification',
  method: 'POST',
  path: '/generalSetting/kallNotification',
  summary: 'Toggle Kall notifications',
  tags: [...WRITE_TAGS, 'notification'],
  destructive: true,
  request: body(() => ({ enable: 1 })),
  note: 'workbook documents no body; toggle shape inferred',
});

export const settingsWriteApis = [
  fontSettingApi,
  changeThemeApi,
  katchupNotificationApi,
  kmailNotificationApi,
  kallNotificationApi,
];
