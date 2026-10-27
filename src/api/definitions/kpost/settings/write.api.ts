import { typesOnlySchema } from '@api/schema/sample-schema';
import { body } from '../kpost-endpoint';
import { defineSettingsEndpoint } from './settings-endpoint';

/**
 * Settings writes (font, theme, notification toggles) on the caller's own preferences. None is
 * `productionSafe`; the self-restoring SETTINGS_LIFECYCLE flow drives them.
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

/** The notification toggle body from GeneralSettingServiceImpl; "Do Not Disturb" is required. */
export const notificationToggleBody = (doNotDisturb: 'On' | 'Off' = 'Off') => ({
  'Message Preview': 'On',
  Sound: 'On',
  Vibrate: 'On',
  'Do Not Disturb': doNotDisturb,
});

export const katchupNotificationApi = defineSettingsEndpoint({
  id: 'settings-katchup-notification',
  // The response says 'Updated Successfully' whatever it stored; only the row can contradict it.
  database: { validations: ['kpost-settings-persisted'] },
  method: 'POST',
  path: '/generalSetting/katchupNotification',
  summary: 'Toggle Katchup notifications',
  tags: [...WRITE_TAGS, 'notification'],
  destructive: true,
  request: body(() => notificationToggleBody()),
  requestSchema: typesOnlySchema(notificationToggleBody()),
  note: 'body keys read from GeneralSettingServiceImpl (workbook documents none)',
});

export const kmailNotificationApi = defineSettingsEndpoint({
  id: 'settings-kmail-notification',
  method: 'POST',
  path: '/generalSetting/kmailNotification',
  summary: 'Toggle KMail notifications',
  tags: [...WRITE_TAGS, 'notification'],
  destructive: true,
  request: body(() => notificationToggleBody()),
  requestSchema: typesOnlySchema(notificationToggleBody()),
  note: 'body keys read from GeneralSettingServiceImpl (workbook documents none)',
});

export const kallNotificationApi = defineSettingsEndpoint({
  id: 'settings-kall-notification',
  method: 'POST',
  path: '/generalSetting/kallNotification',
  summary: 'Toggle Kall notifications',
  tags: [...WRITE_TAGS, 'notification'],
  destructive: true,
  request: body(() => notificationToggleBody()),
  requestSchema: typesOnlySchema(notificationToggleBody()),
  note: 'body keys read from GeneralSettingServiceImpl (workbook documents none)',
});

export const settingsWriteApis = [
  fontSettingApi,
  changeThemeApi,
  katchupNotificationApi,
  kmailNotificationApi,
  kallNotificationApi,
];
