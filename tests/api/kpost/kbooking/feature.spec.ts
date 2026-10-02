import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * KBooking **feature flow** — the real bus-search chain a caller walks through on screen:
 * city autocomplete → destinations reachable from that city → available trips on a date →
 * seat/fare details for one trip. Each step is fed the REAL value the previous step returned
 * (shapes measured from `KBook.js`'s own response handling, not guessed):
 *   - `citysuggestion` → `{ status, value: [{ cityID, cityName }] }` (KBook.js:1230-1231 — `city.cityID`)
 *   - `destinations` → `{ status, value: { cities: [{ id, name }] } }` (KBook.js:384-387)
 *   - `availabletrips` → `{ status, value1: { "<tripID>": {...trip} } }`, an OBJECT keyed by tripID,
 *     not an array (KBook.js:740 — `Object.entries(busList)`, `busList = response.value1`)
 *   - `tripdetails` is fed that real tripID key.
 *
 * `tripDetails` is not `productionSafe` (it needs a real runtime id), so it runs here with
 * `allowLiveRead`, same pattern as Dashboard's `homeDashboardNewMsgs`.
 *
 * `blockTicket` is a real (if SeatSeller "Test Credentials"-labelled) third-party seat hold — its
 * own definition note already flags it as NOT confirmed to be a true sandbox. Per the concurrency/
 * payment-sandbox precedent in this bench, a write of unconfirmed real-world effect is WRITTEN here
 * but deliberately left unconditionally skipped pending explicit authorization, not merely gated
 * behind an env flag nobody has been told is safe to set.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

interface CitySuggestionResponse {
  status?: string;
  value?: Array<{ cityID?: string; cityName?: string }> | null;
}
interface DestinationsResponse {
  status?: string;
  value?: { cities?: Array<{ id?: string | number; name?: string }> } | null;
}
interface AvailableTripsResponse {
  status?: string;
  value1?: Record<string, unknown> | null;
}

function futureTravelDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

test.describe('KPost KBooking · feature flow @api @kbooking', () => {
  test('search chain: city → destinations → available trips → trip details, each fed the prior real result', async ({
    endpoints,
  }) => {
    const citySuggestion = await endpoints.sendTo(
      'kbooking-city-suggestion',
      { pathParams: { query: 'chennai' } },
      { label: 'kbooking:city-suggestion', auth: { principal: A } },
    );
    expect(citySuggestion.status, 'citysuggestion succeeds').toBe(200);
    const cityBody = JSON.parse(citySuggestion.bodyText ?? '{}') as CitySuggestionResponse;
    const sourceCityID = cityBody.value?.[0]?.cityID;
    test.skip(!sourceCityID, 'no city returned for "chennai" right now — cannot chain the search');

    const destinations = await endpoints.sendTo(
      'kbooking-destinations',
      { body: { sourceCityID } },
      { label: 'kbooking:destinations', auth: { principal: A } },
    );
    expect(destinations.status, 'destinations succeeds for a real source city').toBe(200);
    const destBody = JSON.parse(destinations.bodyText ?? '{}') as DestinationsResponse;
    const destinationCityID = destBody.value?.cities?.[0]?.id;
    test.skip(
      destinationCityID === undefined,
      'no reachable destination returned for this source city right now',
    );

    const trips = await endpoints.sendTo(
      'kbooking-available-trips',
      {
        body: {
          sourceCityID,
          destinationCityID,
          travelDate: futureTravelDate(14),
        },
      },
      { label: 'kbooking:available-trips', auth: { principal: A } },
    );
    expect(trips.status, 'availabletrips succeeds for a real route').toBe(200);
    const tripsBody = JSON.parse(trips.bodyText ?? '{}') as AvailableTripsResponse;
    const tripID = Object.keys(tripsBody.value1 ?? {})[0];
    test.skip(
      !tripID,
      'no trips running on this real route 14 days out right now — nothing to chain tripdetails to',
    );

    const details = await endpoints.sendTo(
      'kbooking-trip-details',
      { body: { tripID } },
      { label: 'kbooking:trip-details-with-real-id', auth: { principal: A }, allowLiveRead: true },
    );
    expect(
      details.status,
      `tripdetails succeeds when fed a real tripID (${tripID}) from the search just performed`,
    ).toBe(200);
  });

  test.describe('blockTicket — WRITTEN, NOT EXECUTED', () => {
    /*
     * Unconditionally skipped: blockTicket places a real third-party seat hold via SeatSeller, and
     * its own endpoint definition note already records that the "Test Credentials" label is NOT
     * confirmed to mean a true sandbox. Placing a real-world hold on live bus inventory without that
     * confirmation is exactly the class of action this bench's governance requires explicit owner
     * authorization for first (the same standard already applied to the Razorpay payment path and
     * the OTP-bypass flag) — so this is deliberately never gated behind a plain env var a future run
     * could set by accident.
     */
    test.skip(true, 'real third-party seat hold, unconfirmed sandbox — needs explicit authorization');

    test('blockTicket holds seats on a real trip pending payment', async ({ endpoints }) => {
      const ex = await endpoints.sendTo(
        'kbooking-block-ticket',
        {
          pathParams: { kpostId: testData.kpostId },
          body: {
            inventoryItems: [
              {
                fare: 450,
                ladiesSeat: false,
                passenger: {
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
                },
                seatName: 'U1',
              },
            ],
          },
        },
        { label: 'kbooking:block-ticket', auth: { principal: A }, allowLiveWrite: true },
      );
      expect(ex.status, 'blockTicket succeeds against a real available trip').toBe(200);
    });
  });
});
