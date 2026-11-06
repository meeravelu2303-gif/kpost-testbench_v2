import { notificationToggleBody } from '@api/definitions/kpost/settings/write.api';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { expectStored } from '../../../support/db-stored';

/**
 * Settings feature flow: change the caller's own preferences and restore them in a `finally`.
 * Gated `SETTINGS_LIFECYCLE=true` because the writes persist. Font/theme: settings-personalize-data-integrity.spec.ts.
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

/** A stored JSON column holds every key of `sent` with the value sent (mysql2 parses JSON columns). */
const holdsPreferences =
  (sent: Record<string, unknown>) =>
  (value: unknown): boolean => {
    let stored: unknown = value;
    try {
      if (Buffer.isBuffer(value)) stored = JSON.parse(value.toString('utf8'));
      else if (typeof value === 'string') stored = JSON.parse(value);
    } catch {
      return false;
    }
    if (!stored || typeof stored !== 'object') return false;
    const row = stored as Record<string, unknown>;
    return Object.entries(sent).every(([key, want]) => String(row[key]) === String(want));
  };

test.describe(
  'KPost Settings · feature flow',
  { tag: ['@api', '@settings', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default' });
    test.skip(
      process.env.SETTINGS_LIFECYCLE !== 'true',
      'changes account preferences; set SETTINGS_LIFECYCLE=true',
    );

    test(
      'the three notification toggles are each accepted, then restored on @api @settings',
      { tag: '@sanity' },
      async ({ endpoints, databases }) => {
        const db = databases.for('kpost-api');
        const toggles: Array<[string, string]> = [
          ['settings-katchup-notification', 'katchup'],
          ['settings-kmail-notification', 'kmail'],
          ['settings-kall-notification', 'kall'],
        ];
        const sent = notificationToggleBody('On');
        const statuses = new Map<string, number>();
        try {
          for (const [id, label] of toggles) {
            const off = await write(endpoints, id, sent, `${label}-dnd-on`);
            statuses.set(id, off);
            expect.soft(off, `${label} notification toggle is accepted`).toBeLessThan(300);
          }
          // GeneralSettingServiceImpl.java:219 writes the four preferences sent into kmail_notification.
          if ((statuses.get('settings-kmail-notification') ?? 500) < 300)
            await expectStored(
              db,
              'settings-kmail-notification',
              {
                table: 'TBL_KPOST_GENERAL_SETTINGS',
                where: { kpost_id: A.username },
                columns: { kmail_notification: holdsPreferences(sent) },
                rule: "kmailNotification stores the four preferences sent in the caller's kmail_notification",
              },
              endpoints,
            );
          // GeneralSettingServiceImpl.java:285 writes the four preferences sent into kall_notification.
          if ((statuses.get('settings-kall-notification') ?? 500) < 300)
            await expectStored(
              db,
              'settings-kall-notification',
              {
                table: 'TBL_KPOST_GENERAL_SETTINGS',
                where: { kpost_id: A.username },
                columns: { kall_notification: holdsPreferences(sent) },
                rule: "kallNotification stores the four preferences sent in the caller's kall_notification",
              },
              endpoints,
            );
        } finally {
          // Restore notifications to enabled.
          for (const [id, label] of toggles) {
            await write(endpoints, id, notificationToggleBody('Off'), `${label}-restore`).catch(
              () => undefined,
            );
          }
        }
      },
    );
  },
);
