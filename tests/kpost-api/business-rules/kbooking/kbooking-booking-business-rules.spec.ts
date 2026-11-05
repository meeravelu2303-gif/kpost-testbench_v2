import type { APIRequestContext } from '@playwright/test';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { env } from '@config/env';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';

/**
 * KBooking (RedBus bus booking) input and state rules the engine's per-field cases do not reach,
 * read from RedBusIntegrationController (KPOST_V5.0, controller/integration). There is no KBooking
 * FRD in D:\Kpost Documents, so every rule below cites the controller.
 *
 * - The search reads (availabletrips, destinations) are read-only and cleared for live, so they run
 *   ungated.
 * - The blockTicket probes are gated behind `KBOOKING_LIFECYCLE=true`. blockTicket is a real seat hold
 *   at the partner and has no undo (a hold only expires), so these probes send bodies that CANNOT hold
 *   a seat: no seats at all, or a trip id that does not exist. They prove the refusal without placing a
 *   hold; read-back is the caller's own booking list (`/redbus/getTicket/`, which the web app reads,
 *   KBooking.js FetchTickets). A hold on a real, already-taken seat ("slot already taken") is not
 *   probed: if the partner wrongly accepted it, the hold could not be undone (CLAUDE.md §5 rule 8).
 *   The owner has not yet authorized blockTicket execution (kbooking-bus-search-e2e.spec.ts), so leave the
 *   flag off until they do.
 */

const K = AUTH_PROFILES.kpost;
const A: Principal = K.principals.find((p) => p.key === 'personal')!;
const BASE = env.KPOST_API_BASE_URL ?? env.API_BASE_URL;

type Row = Record<string, unknown>;

/** A scalar as text; anything else (object, null) is ''. */
const str = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';

/** `YYYY-MM-DD` in India time (the controller compares against `LocalDate.now(Asia/Kolkata)`). */
function istDate(daysFromToday: number): string {
  const ist = new Date(Date.now() + 5.5 * 3_600_000 + daysFromToday * 86_400_000);
  return ist.toISOString().slice(0, 10);
}

function bodyOf(ex: { json(): { ok: boolean; value?: unknown } }): Row {
  const parsed = ex.json();
  return (parsed.ok ? parsed.value : {}) as Row;
}

/**
 * The caller's own bookings. `/redbus/getTicket/` is not in the workbook, so it has no endpoint
 * definition; it is a read scoped to the token (RedBusIntegrationController.getPassengerDetails), read
 * raw as the web app does (GET, KBooking.js FetchTickets). Undefined when the list could not be read.
 */
async function myBookings(
  endpoints: EndpointExecutor,
  request: APIRequestContext,
  who: Principal,
): Promise<Row[] | undefined> {
  const token = await endpoints.tokens.tokenFor(who, K);
  const res = await request.get(`${BASE}/redbus/getTicket/`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (res.status() !== 200) return undefined;
  const parsed = (await res.json().catch(() => ({}))) as Row;
  return Array.isArray(parsed.value) ? (parsed.value as Row[]) : [];
}

const bookingKeys = (rows: Row[] | undefined): string[] =>
  (rows ?? []).map((r) => str(r.bookingId) || str(r.tinNumber) || JSON.stringify(r));

const trips = (endpoints: EndpointExecutor, body: Row, label: string) =>
  endpoints.sendTo(
    'kbooking-available-trips',
    { body },
    { label: `kbooking-rules:${label}`, auth: { principal: A }, allowLiveRead: true },
  );

const blockTicket = (endpoints: EndpointExecutor, body: Row, label: string) =>
  endpoints.sendTo(
    'kbooking-block-ticket',
    { pathParams: { kpostId: A.username }, body },
    { label: `kbooking-rules:${label}`, auth: { principal: A }, allowLiveWrite: true },
  );

/** The bench's existing passenger shape (kbooking.api.ts, from KBook.js handleProceedPay). */
const passenger = {
  address: 'KPOST Software Pvt Ltd',
  age: '30',
  email: 'qa-bench@kpostindia.com',
  gender: 'Male',
  idNumber: 'ID123',
  idType: 'PAN_CARD',
  mobile: '9000000000',
  name: 'QA Bench',
  primary: 'true',
  title: 'Mr',
};

test.describe(
  'KPost KBooking · input and state rules',
  { tag: ['@api', '@kbooking', '@verticals', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default' });
    test.skip(!A, 'needs the personal principal');

    test('a trip search for a date in the past is refused with 400 @api @kbooking', async ({
      endpoints,
    }) => {
      // RedBusIntegrationController.getAvailableTrips (KPA-1063 / KPA-1067): a travelDate before today
      // (Asia/Kolkata) is answered 400 "travelDate must be today or a future date". Two days back, so
      // a UTC/IST day boundary cannot make it today.
      const body = { sourceCityID: '102', destinationCityID: 104, travelDate: istDate(-2) };
      const ex = await trips(endpoints, body, 'past-date');
      const errorcode = str(bodyOf(ex).errorcode);
      if (ex.status !== 400) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kbooking-available-trips',
          ruleId: 'KBOOKING-travel-date-not-past',
          rule: 'availabletrips must refuse a travelDate before today (Asia/Kolkata) with 400 "travelDate must be today or a future date" (RedBusIntegrationController.getAvailableTrips, KPA-1063).',
          expected: '400 travelDate must be today or a future date',
          actual: `availabletrips answered ${ex.status} for travelDate ${body.travelDate}: ${ex.bodyText.slice(0, 200)}`,
          request: { body },
        });
      }
      expect.soft(ex.status, 'a past travel date is refused with 400').toBe(400);
      expect.soft(errorcode, 'the refusal names the past-date rule').toMatch(/today or a future/i);
    });

    test('a trip search for a date that does not exist (Feb 30) is refused with 400 @api @kbooking', async ({
      endpoints,
    }) => {
      // RedBusIntegrationController.isValidTravelDate (KP-D7C90D): the date must match yyyy-MM-dd AND
      // parse as a real calendar date; anything else is 400 before the partner is called.
      const year = new Date().getUTCFullYear() + 1;
      const body = { sourceCityID: '102', destinationCityID: 104, travelDate: `${year}-02-30` };
      const ex = await trips(endpoints, body, 'impossible-date');
      if (ex.status !== 400) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kbooking-available-trips',
          ruleId: 'KBOOKING-travel-date-real-calendar-date',
          rule: 'availabletrips must refuse a travelDate that is well-formed but not a real calendar date with 400 (RedBusIntegrationController.isValidTravelDate, KP-D7C90D).',
          expected: '400, the partner is not called',
          actual: `availabletrips answered ${ex.status} for travelDate ${body.travelDate}`,
          request: { body },
        });
      }
      expect.soft(ex.status, 'February 30 is refused with 400').toBe(400);
    });

    test('a trip search between cities that do not exist is a client error, not a 5xx @api @kbooking', async ({
      endpoints,
    }) => {
      // RedBusIntegrationController.getAvailableTrips: bad search input is the caller's error -> 400
      // (KP-0B3492); only a genuine integration failure is a 5xx (KP-65820A). A city id the partner does
      // not know is caller input, so the answer is a 4xx or an empty 200, never a 500.
      const body = {
        sourceCityID: '987654321',
        destinationCityID: 987654322,
        travelDate: istDate(14),
      };
      const ex = await trips(endpoints, body, 'unknown-cities');
      const tripsFound = Object.keys((bodyOf(ex).value1 as Row | undefined) ?? {}).length;
      if (ex.status >= 500) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kbooking-available-trips',
          ruleId: 'KBOOKING-unknown-city-is-client-error',
          rule: 'availabletrips must answer a city id that does not exist as the caller’s error (4xx, or 200 with no trips), not as a server error (RedBusIntegrationController.getAvailableTrips, KP-0B3492).',
          expected: 'a 4xx or 200 with no trips',
          actual: `availabletrips answered ${ex.status}: ${ex.bodyText.slice(0, 200)}`,
          request: { body },
        });
      }
      expect.soft(ex.status, 'unknown cities are not a server error').toBeLessThan(500);
      expect.soft(tripsFound, 'no trips are listed between unknown cities').toBe(0);
    });

    test('a destinations lookup for a city that does not exist does not answer a failure as HTTP 200 @api @kbooking', async ({
      endpoints,
    }) => {
      // RedBusIntegrationController.getAllDestinations: its catch block answers status FAILURE with the
      // exception text in `errorvalue` as HTTP 200. The same controller fixed this for availabletrips
      // (KP-65820A: "an upstream/integration failure must not be answered as HTTP 200"). Correct: an
      // empty SUCCESS list, or a 4xx without internal exception text.
      const body = { sourceCityID: '987654321' };
      const ex = await endpoints.sendTo(
        'kbooking-destinations',
        { body },
        { label: 'kbooking-rules:unknown-source', auth: { principal: A }, allowLiveRead: true },
      );
      const reply = bodyOf(ex);
      const failed = str(reply.status).toUpperCase() === 'FAILURE';
      const errorvalue = str(reply.errorvalue);
      if (failed && ex.status === 200) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'kbooking-destinations',
          ruleId: 'KBOOKING-destinations-failure-not-200',
          rule: 'destinations must not answer a FAILURE as HTTP 200 with the exception text in errorvalue; availabletrips was fixed for the same fault (KP-65820A, RedBusIntegrationController).',
          expected: 'an empty SUCCESS list, or a 4xx with a plain message',
          actual: `destinations answered HTTP 200 with status FAILURE, errorvalue "${errorvalue.slice(0, 160)}"`,
          request: { body },
        });
      }
      expect.soft(failed && ex.status === 200, 'a FAILURE is not answered as HTTP 200').toBe(false);
      expect
        .soft(errorvalue, 'no Java exception text is returned')
        .not.toMatch(/exception|\tat |java\.|psl\./i);
    });

    test.describe('blockTicket (gated, cannot hold a seat)', () => {
      test.skip(
        process.env.KBOOKING_LIFECYCLE !== 'true',
        'calls blockTicket (a real partner seat hold) with bodies that cannot hold a seat; needs the owner’s authorization, then KBOOKING_LIFECYCLE=true',
      );
      test.skip(!BASE, 'KPOST_API_BASE_URL / API_BASE_URL is not set');

      test('a seat hold with no seats is refused and no booking is recorded @api @kbooking', async ({
        endpoints,
        request,
      }) => {
        // RedBusIntegrationController.blockTicket only checks the body is not null, then asks the
        // partner to hold "the specified seats" (its javadoc). A hold with no seats is meaningless
        // input: it must be refused with a 4xx before the partner is called, and nothing recorded
        // (updateBookingDetails writes a "tendative booking" row only when a hold key comes back).
        const before = await myBookings(endpoints, request, A);
        const body = { availableTripId: '1', inventoryItems: [] };
        const ex = await blockTicket(endpoints, body, 'no-seats');
        const after = await myBookings(endpoints, request, A);
        const added = bookingKeys(after).filter((k) => !bookingKeys(before).includes(k));
        if (ex.status < 400 || added.length) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kbooking-block-ticket',
            ruleId: 'KBOOKING-block-needs-a-seat',
            rule: 'blockTicket must refuse a hold with no seats (empty inventoryItems) with a 4xx before calling the partner; RedBusIntegrationController.blockTicket only checks the body is not null.',
            expected: 'a 4xx, no booking row recorded',
            actual: `blockTicket answered ${ex.status} (${ex.bodyText.slice(0, 160)}); new booking rows: ${added.length}`,
            request: { pathParams: { kpostId: A.username }, body },
          });
        }
        expect.soft(ex.status, 'a hold with no seats is refused').toBeGreaterThanOrEqual(400);
        expect.soft(ex.status, 'and it is not a server error').toBeLessThan(500);
        expect.soft(added, 'no booking is recorded for a hold with no seats').toEqual([]);
      });

      test('a seat hold on a trip that does not exist is refused and no booking is recorded @api @kbooking', async ({
        endpoints,
        request,
      }) => {
        // RedBusIntegrationController.blockTicket: a partner failure is caught and answered as HTTP 200
        // status FAILURE. A trip that does not exist is the caller's error (the controller's own rule
        // for bad search input, KP-0B3492): a 4xx, and no "tendative booking" row
        // (updateBookingDetails). The trip id is made up, so no seat can be held.
        const before = await myBookings(endpoints, request, A);
        const body = {
          availableTripId: '1',
          boardingPointId: '1',
          droppingPointId: '1',
          source: '102',
          destination: '104',
          inventoryItems: [{ fare: 450, ladiesSeat: false, passenger, seatName: 'U1' }],
        };
        const ex = await blockTicket(endpoints, body, 'unknown-trip');
        const after = await myBookings(endpoints, request, A);
        const added = bookingKeys(after).filter((k) => !bookingKeys(before).includes(k));
        const succeeded =
          str(bodyOf(ex).status).toUpperCase() === 'SUCCESS' && bodyOf(ex).value != null;
        if (ex.status < 400 || added.length || succeeded) {
          endpoints.recordBusinessRuleViolation({
            endpointId: 'kbooking-block-ticket',
            ruleId: 'KBOOKING-block-unknown-trip',
            rule: 'blockTicket must refuse a trip id that does not exist with a 4xx and record nothing; RedBusIntegrationController.blockTicket answers a partner failure as HTTP 200.',
            expected: 'a 4xx, no hold key, no booking row recorded',
            actual: `blockTicket answered ${ex.status} (${ex.bodyText.slice(0, 160)}); new booking rows: ${added.length}`,
            request: { pathParams: { kpostId: A.username }, body },
          });
        }
        expect.soft(ex.status, 'a hold on an unknown trip is refused').toBeGreaterThanOrEqual(400);
        expect.soft(ex.status, 'and it is not a server error').toBeLessThan(500);
        expect.soft(succeeded, 'no hold key is returned for an unknown trip').toBe(false);
        expect.soft(added, 'no booking is recorded for an unknown trip').toEqual([]);
      });
    });
  },
);
