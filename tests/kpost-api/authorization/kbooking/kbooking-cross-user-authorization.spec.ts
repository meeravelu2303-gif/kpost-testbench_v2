import type { APIRequestContext } from '@playwright/test';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { env } from '@config/env';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * KBooking cross-user: one user cannot read, cancel or place a booking as another user. The backend
 * scopes each by the token's kpostID (RedBusIntegrationController, KPOST_V5.0):
 * - getTicket lists `findByKpostId(<token kpostID>)` (getPassengerDetails);
 * - ticketdetails and cancelticket answer 403 unless `existsByPnrNumberAndKpostId(ticketNumber,
 *   <token kpostID>)` (isTicketOwnedBy, KP-1015);
 * - blockTicket/{kPostId} answers 403 unless the path kPostId is the caller's (KP-REDBUSBLOCKIDENTITYSPOOF).
 *
 * getTicket, ticketdetails and cancelticket are not in the workbook, so they have no endpoint
 * definition: they are called raw, the way the web app calls them (KBooking.js FetchTickets /
 * CancelTicket), and a failure here is the finding.
 *
 * What is NOT done, on purpose (CLAUDE.md §5 rule 8, no write without an undo):
 * - No booking is created: a booking is a real partner seat hold plus payment (live Razorpay key).
 *   The read checks use a ticket a QA account already has, and skip as BLOCKED when none does.
 * - A stranger never names a real ticket on cancelticket: if the ownership check were broken, a real
 *   ticket would be cancelled with no way back. The cancel probe names a made-up ticket number, so a
 *   broken check cancels nothing; it has no owner control for the same reason.
 * - blockTicket is sent with an empty body (no trip, no seats), which cannot hold a seat.
 * The two write probes are gated behind `KBOOKING_LIFECYCLE=true`; the owner has not yet authorized
 * blockTicket execution (kbooking-bus-search-e2e.spec.ts), so leave the flag off until they do.
 */

const K = AUTH_PROFILES.kpost;
const A: Principal = K.principals.find((p) => p.key === 'personal')!;
const V: Principal | undefined = K.principals.find((p) => p.key === 'victim');
const C: Principal = K.principals.find((p) => p.key === 'personal-3')!;
const BASE = env.KPOST_API_BASE_URL ?? env.API_BASE_URL;

type Row = Record<string, unknown>;

/** A scalar as text; anything else (object, null) is ''. */
const str = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';

interface Raw {
  status: number;
  body: Row;
  text: string;
}

/** A raw call to an un-defined `/redbus/*` route as `who`, the way the web app sends it. */
async function raw(
  endpoints: EndpointExecutor,
  request: APIRequestContext,
  who: Principal,
  method: 'GET' | 'POST',
  route: string,
  data?: Row,
): Promise<Raw> {
  const token = await endpoints.tokens.tokenFor(who, K);
  const res = await request.fetch(`${BASE}/redbus/${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(data ? { data } : {}),
  });
  const text = await res.text();
  let body: Row = {};
  try {
    body = JSON.parse(text) as Row;
  } catch {
    // Not JSON: keep the text for the message.
  }
  return { status: res.status(), body, text };
}

/** `who`'s own bookings, or undefined when the list could not be read. */
async function bookings(
  endpoints: EndpointExecutor,
  request: APIRequestContext,
  who: Principal,
): Promise<Row[] | undefined> {
  const res = await raw(endpoints, request, who, 'GET', 'getTicket/');
  if (res.status !== 200) return undefined;
  return Array.isArray(res.body.value) ? (res.body.value as Row[]) : [];
}

const lower = (s: unknown): string => str(s).toLowerCase();

test.describe(
  'KPost Security · KBooking cross-user',
  {
    tag: ['@api', '@kbooking', '@security', '@verticals', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.describe.configure({ mode: 'default' });
    test.skip(!A || !C, 'needs the personal and personal-3 principals');
    test.skip(!BASE, 'KPOST_API_BASE_URL / API_BASE_URL is not set');

    test('each user’s booking list holds only their own bookings @api @kbooking @security', async ({
      endpoints,
      request,
    }) => {
      // getPassengerDetails lists findByKpostId(<token kpostID>): no row of another user may appear.
      const mine = await bookings(endpoints, request, A);
      const theirs = await bookings(endpoints, request, C);
      expect(mine, `owner control: ${A.username} can read their own booking list`).toBeDefined();
      expect(theirs, `${C.username} can read their own booking list`).toBeDefined();
      const foreignInMine = (mine ?? []).filter((r) => lower(r.kpostId) !== lower(A.username));
      const foreignInTheirs = (theirs ?? []).filter((r) => lower(r.kpostId) !== lower(C.username));
      expect
        .soft(
          foreignInMine.map((r) => r.kpostId),
          `${A.username}'s list holds only their own bookings`,
        )
        .toEqual([]);
      expect
        .soft(
          foreignInTheirs.map((r) => r.kpostId),
          `${C.username}'s list holds only their own bookings`,
        )
        .toEqual([]);
    });

    test('a user cannot read another user’s ticket details @api @kbooking @security', async ({
      endpoints,
      request,
    }) => {
      // ticketdetails answers 403 unless the caller owns the ticket (isTicketOwnedBy, KP-1015). Owner
      // control first: the owner's identical call must get past that check, or the stranger's 4xx
      // proves nothing. The owner is the first QA account that already has a booking.
      let owner: Principal | undefined;
      let ticketNumber: string | undefined;
      for (const who of [A, V].filter((p): p is Principal => Boolean(p))) {
        for (const row of (await bookings(endpoints, request, who)) ?? []) {
          // The ownership check matches PNRNUMBER; the web app sends `tin`. Try both, PNR first.
          for (const candidate of [row.pnrNumber, row.tinNumber]) {
            if (typeof candidate !== 'string' || !candidate) continue;
            const control = await raw(endpoints, request, who, 'POST', 'ticketdetails/', {
              ticketNumber: candidate,
            });
            if (control.status === 200) {
              owner = who;
              ticketNumber = candidate;
              break;
            }
          }
          if (owner) break;
        }
        if (owner) break;
      }
      test.skip(
        !owner || !ticketNumber,
        'BLOCKED: needs a QA account (personal or victim) that already has a bus booking whose details it can read; no booking is created here (real seat hold + payment)',
      );

      const attack = await raw(endpoints, request, C, 'POST', 'ticketdetails/', { ticketNumber });
      expect
        .soft(attack.status, `${C.username} is refused ${owner!.username}'s ticket ${ticketNumber}`)
        .toBe(403);
      expect.soft(attack.body.value ?? null, 'no ticket is returned to the stranger').toBeNull();
      expect
        .soft(lower(attack.text), 'the refusal does not echo the owner’s identity')
        .not.toContain(lower(owner!.username));
    });

    test.describe('write probes (gated, cannot change a real booking)', () => {
      test.skip(
        process.env.KBOOKING_LIFECYCLE !== 'true',
        'sends blockTicket / cancelticket probes that cannot hold or cancel anything; needs the owner’s authorization, then KBOOKING_LIFECYCLE=true',
      );

      test('a user cannot cancel a ticket that is not theirs @api @kbooking @security', async ({
        endpoints,
        request,
      }) => {
        // cancelticket answers 403 unless the caller owns the ticket (isTicketOwnedBy, KP-1015), and
        // must check that BEFORE calling the partner. A made-up ticket number: a broken check cancels
        // nothing (see the header). Read-back: the caller's own bookings are unchanged.
        const ticketNumber = `QABENCH${Date.now()}`;
        const before = await bookings(endpoints, request, C);
        const body = { ticketNumber, seatsToCancel: ['U1'] };
        const attack = await raw(endpoints, request, C, 'POST', 'cancelticket/', body);
        const after = await bookings(endpoints, request, C);
        expect
          .soft(
            attack.status,
            `cancelling ticket ${ticketNumber}, which ${C.username} does not own`,
          )
          .toBe(403);
        expect
          .soft(lower(attack.body.status), 'the cancel is not reported as a success')
          .not.toBe('success');
        expect
          .soft(JSON.stringify(after ?? []), 'the caller’s bookings are unchanged')
          .toBe(JSON.stringify(before ?? []));
      });

      test('a user cannot place a seat hold under another user’s KPost ID @api @kbooking @security', async ({
        endpoints,
        request,
      }) => {
        // blockTicket/{kPostId} answers 403 unless kPostId is the caller's own
        // (KP-REDBUSBLOCKIDENTITYSPOOF). Empty body: no trip and no seats, so nothing can be held.
        const asOwner = { auth: { principal: A }, allowLiveWrite: true };
        const asStranger = { auth: { principal: C }, allowLiveWrite: true };
        const spec = { pathParams: { kpostId: A.username }, body: {} };
        const before = await bookings(endpoints, request, A);

        // Owner control: A's identical call gets past the identity check (any answer but 401/403).
        const control = await endpoints.sendTo('kbooking-block-ticket', spec, {
          label: 'kbooking-xu:block-owner-control',
          ...asOwner,
        });
        const controlPassed = control.status !== 401 && control.status !== 403;
        expect
          .soft(
            controlPassed,
            `owner control: ${A.username}'s own blockTicket call is not refused as forbidden (HTTP ${control.status})`,
          )
          .toBe(true);
        if (!controlPassed) return;

        const attack = await endpoints.sendTo('kbooking-block-ticket', spec, {
          label: 'kbooking-xu:block-attack',
          ...asStranger,
        });
        const after = await bookings(endpoints, request, A);
        const changed = JSON.stringify(after ?? []) !== JSON.stringify(before ?? []);
        if (attack.status !== 403 || changed) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kbooking-block-ticket',
            ruleId: 'IDOR-kbooking-block-ticket-cross-user',
            rule: 'blockTicket/{kPostId} must refuse with 403 a kPostId that is not the caller’s own, so no one can place a seat hold under another user’s account (RedBusIntegrationController.blockTicket, KP-REDBUSBLOCKIDENTITYSPOOF).',
            expected: `403, ${A.username}'s bookings unchanged`,
            actual: `${C.username} got HTTP ${attack.status} for blockTicket/${A.username}; ${A.username}'s bookings ${changed ? 'changed' : 'unchanged'}`,
            request: spec,
          });
        }
        expect.soft(attack.status, `${C.username} cannot hold seats as ${A.username}`).toBe(403);
        expect.soft(changed, `${A.username}'s bookings are unchanged`).toBe(false);
      });
    });
  },
);
