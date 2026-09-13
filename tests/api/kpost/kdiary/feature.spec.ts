// An orchestrated diary lifecycle (create → participants → remarks → delete), not simple
// assertions; the conditionals guard optional steps and cleanup of real live data.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import { scheduleShape } from '@api/definitions/kpost/kdiary/write.api';

/**
 * KDiary **feature flow** — create a diary event, add a participant, set its remarks, then delete it.
 * Self-cleaning: the created event is deleted in a `finally`. Gated `KDIARY_LIFECYCLE=true`, each
 * write `allowLiveWrite`. The bodies are the live client's / inferred (the workbook documents none),
 * so a 4xx here is a payload gap to confirm, not necessarily a defect — `expect.soft` reports all.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

/** The created schedule/event id across the response shapes the API might use. */
function extractId(bodyObj: Record<string, unknown>): number | undefined {
  const data = bodyObj.data;
  const obj = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<
    string,
    unknown
  >;
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  for (const c of [obj.eventID, obj.id, obj.eventID, row?.eventID, row?.id]) {
    if (typeof c === 'number') return c;
  }
  return undefined;
}

async function write(
  endpoints: EndpointExecutor,
  id: string,
  bodyObj: Record<string, unknown>,
  label: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const ex = await endpoints.sendTo(
    id,
    { body: bodyObj },
    { label: `kdiary:${label}`, auth: { principal: A }, allowLiveWrite: true },
  );
  const parsed = ex.json();
  return { status: ex.status, body: (parsed.ok ? parsed.value : {}) as Record<string, unknown> };
}

test.describe('KPost KDiary · feature flow', () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    process.env.KDIARY_LIFECYCLE !== 'true',
    'writes real diary events; set KDIARY_LIFECYCLE=true',
  );

  test('create event → add participant → set remarks → delete @api @kdiary', async ({
    endpoints,
  }) => {
    let eventID: number | undefined;
    try {
      const created = await write(endpoints, 'kdiary-create-event', scheduleShape(), 'create');
      expect.soft(created.status, 'creating a diary event is accepted').toBeLessThan(300);
      eventID = extractId(created.body);
      expect.soft(eventID, 'the created event issues an id').toBeTruthy();

      if (eventID) {
        const parts = await write(
          endpoints,
          'kdiary-add-participants',
          { eventID, participants: [testData.victimKpostId] },
          'participants',
        );
        expect.soft(parts.status, 'adding a participant is accepted').toBeLessThan(300);

        const remarks = await write(
          endpoints,
          'kdiary-update-remarks',
          { eventID, remarks: 1, remarksDescription: 'Completed by QA' },
          'remarks',
        );
        expect.soft(remarks.status, 'setting remarks is accepted').toBeLessThan(300);
      }
    } finally {
      if (eventID) {
        await write(endpoints, 'kdiary-delete-event', { eventID }, 'delete').catch(() => undefined);
      }
    }
  });
});
