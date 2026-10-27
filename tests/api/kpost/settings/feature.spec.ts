import { notificationToggleBody } from '@api/definitions/kpost/settings/write.api';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * Settings feature flow: change the caller's own preferences and restore them in a `finally`.
 * Gated `SETTINGS_LIFECYCLE=true` because the writes persist. Font/theme: personalize-workflow.spec.ts.
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
      async ({ endpoints }) => {
        const toggles: Array<[string, string]> = [
          ['settings-katchup-notification', 'katchup'],
          ['settings-kmail-notification', 'kmail'],
          ['settings-kall-notification', 'kall'],
        ];
        try {
          for (const [id, label] of toggles) {
            const off = await write(endpoints, id, notificationToggleBody('On'), `${label}-dnd-on`);
            expect.soft(off, `${label} notification toggle is accepted`).toBeLessThan(300);
          }
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
