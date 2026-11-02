import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { KALL_REPEAT_TYPE } from '@api/contract/kpost-types';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { scheduleShape } from '@api/definitions/kpost/kall/schedule.api';

/**
 * A Kool Kall's subject, session and link are checked on every way in, not only on first schedule.
 * scheduledKall refuses a script subject, an unsafe kallSession and a non-web meetingLink
 * (KallControllerV3.validateScheduledKall, added for #1306 stored XSS on the dashboard), but
 * reScheduleKall and scheduledRepeatKall skip those checks. Each write is our own QA call, and every
 * call log the test touched is cleared afterwards. Gated behind KALL_LIFECYCLE=true.
 */
const K = AUTH_PROFILES.kpost;
const principal = (key: string): Principal => {
  const found = K.principals.find((p) => p.key === key);
  if (!found) throw new Error(`principal "${key}" is not configured`);
  return found;
};
const A = principal('personal');
const B = principal('victim');

const SCRIPT_SUBJECT = 'QA bench <img src=x onerror=alert(1)>';
const BAD_INPUTS = [
  { label: 'a script subject', patch: { subject: SCRIPT_SUBJECT } },
  { label: 'an unsafe kallSession', patch: { kallSession: 'qa bench <session>' } },
  { label: 'a javascript: meetingLink', patch: { meetingLink: 'javascript:alert(1)' } },
] as const;

const kallIdOf = (body: unknown): number | undefined => {
  const data = (body as { data?: unknown } | undefined)?.data;
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return typeof row?.kallID === 'number' ? row.kallID : undefined;
};

async function clearHistory(endpoints: EndpointExecutor, who: Principal[]): Promise<void> {
  for (const as of who) {
    await endpoints
      .sendTo(
        'kall-clear-history',
        {},
        { label: `kall-rules:cleanup:${as.key}`, auth: { principal: as }, allowLiveWrite: true },
      )
      .catch(() => undefined);
  }
}

test.describe(
  'KPost Kall · reschedule and repeat refuse what a new schedule refuses @api @kpost-api @kall',
  { tag: ['@api', '@kall', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default', timeout: 180_000 });
    test.skip(
      process.env.KALL_LIFECYCLE !== 'true',
      'schedules real calls; set KALL_LIFECYCLE=true (owner sign-off, docs/modules/kall-flow.md §5)',
    );

    test('a script subject, an unsafe session and a javascript: link are refused on every way in', async ({
      endpoints,
    }) => {
      const send = (id: string, body: Record<string, unknown>, label: string) =>
        endpoints.sendTo(
          id,
          { body },
          { label: `kall-rules:${label}`, auth: { principal: A }, allowLiveWrite: true },
        );
      try {
        for (const bad of BAD_INPUTS) {
          const control = await send(
            'kall-scheduled',
            scheduleShape({ kallDetails: [{ receiver: B.username }], ...bad.patch }),
            `schedule:${bad.label}`,
          );
          expect.soft(control.status, `control: scheduledKall refuses ${bad.label}`).toBe(400);
        }

        const created = await send(
          'kall-scheduled',
          scheduleShape({ kallDetails: [{ receiver: B.username }] }),
          'schedule:valid',
        );
        const parsed = created.json();
        const kallID = kallIdOf(parsed.ok ? parsed.value : undefined);
        expect(kallID, 'BLOCKED: needs a scheduled call to reschedule').toBeTruthy();

        for (const bad of BAD_INPUTS) {
          const rescheduled = await send(
            'kall-reschedule',
            scheduleShape({ kallID, kallDetails: [{ receiver: B.username }], ...bad.patch }),
            `reschedule:${bad.label}`,
          );
          expect
            .soft(
              rescheduled.status,
              `reScheduleKall must refuse ${bad.label}, as scheduledKall does`,
            )
            .toBe(400);
          const repeated = await send(
            'kall-scheduled-repeat',
            scheduleShape({
              kallDetails: [{ receiver: B.username }],
              repeatType: KALL_REPEAT_TYPE.daily,
              repeatedDate: JSON.stringify({
                start_date: new Date().toISOString().slice(0, 10),
                end_date: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
              }),
              ...bad.patch,
            }),
            `repeat:${bad.label}`,
          );
          expect
            .soft(
              repeated.status,
              `scheduledRepeatKall must refuse ${bad.label}, as scheduledKall does`,
            )
            .toBe(400);
        }

        // The stored-XSS consequence #1306 was about: the dashboard must never echo the markup.
        const dashboard = await endpoints.sendTo(
          'kall-dashboard',
          { body: { kallID: '' } },
          { label: 'kall-rules:dashboard', auth: { principal: A }, allowLiveRead: true },
        );
        expect
          .soft(dashboard.bodyText, 'kallDashboard returns no script subject (#1306)')
          .not.toContain('onerror=alert(1)');
      } finally {
        await clearHistory(endpoints, [A, B]);
      }
    });
  },
);
