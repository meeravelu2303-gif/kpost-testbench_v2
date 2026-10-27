import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';

/**
 * KBooking feature flow: the bus-search chain (city → destinations → trips → trip details), each step
 * fed the real value the previous one returned (shapes from KBook.js; availabletrips' value1 is an
 * object keyed by tripID). blockTicket is a real third-party seat hold, so it stays skipped.
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

test.describe(
  'KPost KBooking · feature flow @api @kbooking',
  { tag: ['@api', '@verticals', '@regression'] },
  () => {
    test(
      'search chain: city → destinations → available trips → trip details, each fed the prior real result',
      { tag: '@sanity' },
      async ({ endpoints }) => {
        const citySuggestion = await endpoints.sendTo(
          'kbooking-city-suggestion',
          { pathParams: { query: 'chennai' } },
          { label: 'kbooking:city-suggestion', auth: { principal: A } },
        );
        expect(citySuggestion.status, 'citysuggestion succeeds').toBe(200);
        const cityBody = JSON.parse(citySuggestion.bodyText ?? '{}') as CitySuggestionResponse;
        const sourceCityID = cityBody.value?.[0]?.cityID;
        test.skip(
          !sourceCityID,
          'no city returned for "chennai" right now — cannot chain the search',
        );

        const destinations = await endpoints.sendTo(
          'kbooking-destinations',
          { body: { sourceCityID } },
          { label: 'kbooking:destinations', auth: { principal: A } },
        );
        expect(destinations.status, 'destinations succeeds for a real source city').toBe(200);
        const destBody = JSON.parse(destinations.bodyText ?? '{}') as DestinationsResponse;
        const destinationIDs = (destBody.value?.cities ?? [])
          .map((c) => c.id)
          .filter((id) => id !== undefined);
        test.skip(
          destinationIDs.length === 0,
          'no reachable destination returned for this source city right now',
        );

        // The partner's test inventory has few routes: try city 104 (has trips) first, then the listed
        // destinations, at most six tries.
        let tripsBody: AvailableTripsResponse = {};
        let tripID: string | undefined;
        const candidates = [...new Set([104, ...destinationIDs])].slice(0, 6);
        for (const destinationCityID of candidates) {
          const trips = await endpoints.sendTo(
            'kbooking-available-trips',
            { body: { sourceCityID, destinationCityID, travelDate: futureTravelDate(14) } },
            { label: 'kbooking:available-trips', auth: { principal: A } },
          );
          expect(trips.status, 'availabletrips succeeds for a real route').toBe(200);
          tripsBody = JSON.parse(trips.bodyText ?? '{}') as AvailableTripsResponse;
          tripID = Object.keys(tripsBody.value1 ?? {})[0];
          if (tripID) break;
        }
        test.skip(
          !tripID,
          'no trips running on the first six real routes 14 days out right now — nothing to chain tripdetails to',
        );
        if (!tripID) return;

        const details = await endpoints.sendTo(
          'kbooking-trip-details',
          { body: { tripID } },
          {
            label: 'kbooking:trip-details-with-real-id',
            auth: { principal: A },
            allowLiveRead: true,
          },
        );
        expect(
          details.status,
          `tripdetails succeeds when fed a real tripID (${tripID}) from the search just performed`,
        ).toBe(200);

        // The v2 trip details take the same trip as an "inventoryId" (the value1 key — the numeric
        // `id` inside the trip loses precision in JSON). Not called by the web app; workbook-documented.
        const detailsV2 = await endpoints.sendTo(
          'kbooking-trip-details-v2',
          { body: { inventoryId: tripID } },
          {
            label: 'kbooking:trip-details-v2-with-real-id',
            auth: { principal: A },
            allowLiveRead: true,
          },
        );
        expect(detailsV2.status, `tripdetailsV2 succeeds for the real trip ${tripID}`).toBe(200);

        // One boarding point of that trip: boardingTimes[].bpId.
        const trip = (tripsBody.value1 ?? {})[tripID] as {
          boardingTimes?: Array<{ bpId?: number }>;
        };
        const bpId = trip?.boardingTimes?.[0]?.bpId;
        test.skip(
          bpId === undefined,
          'the trip lists no boarding point right now — nothing to look up',
        );
        const boarding = await endpoints.sendTo(
          'kbooking-boarding-point',
          { body: { boardingID: String(bpId), tripID } },
          {
            label: 'kbooking:boarding-point-with-real-id',
            auth: { principal: A },
            allowLiveRead: true,
          },
        );
        expect(
          boarding.status,
          `boardingPoint succeeds for boarding point ${bpId} of trip ${tripID}`,
        ).toBe(200);
      },
    );

    test.describe(
      'blockTicket — WRITTEN, NOT EXECUTED',
      { tag: ['@api', '@verticals', '@regression'] },
      () => {
        // Always skipped (not env-gated): a real SeatSeller seat hold, sandbox unconfirmed.
        test.skip(
          true,
          'real third-party seat hold, unconfirmed sandbox — needs explicit authorization',
        );

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
      },
    );
  },
);
