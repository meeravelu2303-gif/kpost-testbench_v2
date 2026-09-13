import { defineSettingsEndpoint } from './settings-endpoint';

/**
 * Settings **reads** — the caller's own personalization and notification preferences. Both are GETs
 * that read only our own account, so both run on live.
 */
const READ_TAGS = ['settings-read'] as const;

export const getPersonalizeApi = defineSettingsEndpoint({
  id: 'settings-get-personalize',
  method: 'GET',
  path: '/generalSetting/getPersonalize',
  summary: "The caller's personalization (theme, font, layout)",
  tags: [...READ_TAGS, 'personalize'],
  productionSafe: true,
});

export const getAllNotificationApi = defineSettingsEndpoint({
  id: 'settings-get-notifications',
  method: 'GET',
  path: '/generalSetting/getAllNotification',
  summary: "The caller's notification settings (Katchup / KMail / Kall)",
  tags: [...READ_TAGS, 'notification'],
  productionSafe: true,
});

export const settingsReadApis = [getPersonalizeApi, getAllNotificationApi];
