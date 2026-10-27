import { testData } from '@config/test-data.config';
import { pathParamSchema, typesOnlySchema } from '@api/schema/sample-schema';
import { body, pathParams } from '../kpost-endpoint';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';

/**
 * KBooking (`/redbus/*`): bus search and booking via the RedBus/SeatSeller integration. Payloads
 * come from `KBook.js`. Payment stays blocked (live Razorpay key); book/cancel/getTicket are not in
 * the workbook.
 */
function defineKBookingEndpoint(config: KpostEndpointConfig): EndpointDefinition {
  return defineKpostEndpoint({
    ...config,
    authentication: config.authentication ?? { required: true },
    tags: ['kbooking', 'redbus', ...(config.tags ?? [])],
  });
}

export const citySuggestionApi = defineKBookingEndpoint({
  id: 'kbooking-city-suggestion',
  method: 'GET',
  path: '/redbus/citysuggestion/{query}',
  // The workbook documents this path with a literal sample city baked in rather than a template.
  contractPath: '/redbus/citysuggestion/chennai',
  summary: 'City-name autocomplete for the source/destination pickers',
  tags: ['kbooking-read'],
  // A read with no side effect — the frontend calls it on every keystroke of the city field.
  destructive: false,
  productionSafe: true,
  request: pathParams(() => ({ query: 'chennai' })),
  pathParamsSchema: pathParamSchema('query'),
});

export const destinationsApi = defineKBookingEndpoint({
  id: 'kbooking-destinations',
  method: 'POST',
  path: '/redbus/destinations/',
  summary: 'Destination cities reachable from a source city',
  tags: ['kbooking-read'],
  destructive: false,
  productionSafe: true,
  // Real shape, KBook.js:378 — `GetDestinations({ sourceCityID: selectedOption.value })`.
  request: body(() => ({ sourceCityID: '102' })),
  // Types-only, from a captured live body (the RedBus partner envelope, no KPost statusCode).
  responseSchema: typesOnlySchema({ errorvalue: '', value: {}, errorcode: '', status: 'SUCCESS' }),
});

export const availableTripsApi = defineKBookingEndpoint({
  id: 'kbooking-available-trips',
  method: 'POST',
  path: '/redbus/availabletrips/',
  summary: 'Available bus trips between two cities on a date',
  tags: ['kbooking-read'],
  destructive: false,
  productionSafe: true,
  // Real shape, KBook.js:436-445. The date must be today or later: the partner answers 500 for a
  // past date.
  request: body(() => ({
    sourceCityID: '102',
    destinationCityID: 104,
    travelDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  })),
  // Types-only, from a captured live body (the RedBus partner envelope).
  responseSchema: typesOnlySchema({
    value1: {},
    errorvalue: '',
    value: {},
    errorcode: '',
    status: 'SUCCESS',
  }),
});

export const tripDetailsApi = defineKBookingEndpoint({
  id: 'kbooking-trip-details',
  method: 'POST',
  path: '/redbus/tripdetails/',
  summary: 'Seat layout and fare details for one trip',
  tags: ['needs-id'],
  destructive: false,
  // Needs a real tripID from a prior availabletrips search. KBook.js:579.
  productionSafe: false,
  note: 'needs a real tripID from a prior availabletrips search; a placeholder id is not meaningful',
  request: body(() => ({ tripID: '5000035149644122223' })),
});

// Workbook RedBus routes the web app does not call. The two reads run live in the feature chain;
// the city-list refresh is a shared write, validated off live only.
export const boardingPointApi = defineKBookingEndpoint({
  id: 'kbooking-boarding-point',
  method: 'POST',
  path: '/redbus/boardingPoint/',
  summary: 'Details of one boarding point on a trip',
  tags: ['needs-id'],
  destructive: false,
  // Needs a real tripID AND one of that trip's boardingTimes[].bpId from a prior availabletrips search.
  productionSafe: false,
  note: 'needs a real tripID and boarding-point id from a prior availabletrips search; not called by the web app',
  request: body(() => ({ boardingID: '22081702', tripID: '1000002349716549672' })),
});

export const tripDetailsV2Api = defineKBookingEndpoint({
  id: 'kbooking-trip-details-v2',
  method: 'POST',
  path: '/redbus/tripdetailsV2/',
  summary: 'Seat layout and fare details for one trip (v2, by inventory id)',
  tags: ['needs-id'],
  destructive: false,
  // Uses the trip's object key from availabletrips: the numeric `id` field loses precision in JSON.
  productionSafe: false,
  note: 'needs a real inventory (trip) id from a prior availabletrips search; not called by the web app',
  request: body(() => ({ inventoryId: '5000035149752978191' })),
});

export const updateCityListApi = defineKBookingEndpoint({
  id: 'kbooking-update-city-list',
  method: 'GET',
  path: '/redbus/updatecitylist',
  summary: 'Refresh the shared RedBus city list from the partner',
  tags: ['privileged-write'],
  // Rewrites the reference data every user's city picker reads — a shared write, never run on live.
  destructive: true,
  sideEffect: 'global',
  note: 'refreshes shared reference data for every user; not called by the web app',
});

export const blockTicketApi = defineKBookingEndpoint({
  id: 'kbooking-block-ticket',
  method: 'POST',
  path: '/redbus/blockTicket/{kpostId}',
  summary: 'Hold seats on a trip pending payment (pre-payment step)',
  tags: ['needs-id', 'critical'],
  destructive: true,
  // Places a real hold on third-party bus inventory, so it is gated. KBook.js:845-867.
  productionSafe: false,
  // Always skipped in feature.spec.ts: the seat hold may not be a true sandbox. Do not add an env
  // flag for it without the owner's authorization.
  note: 'WRITTEN, EXECUTION BLOCKED pending explicit owner authorization — real third-party seat hold, unconfirmed sandbox (see feature.spec.ts)',
  // Body plus a path param, so an inline factory. `kpostId` is the caller's own id (KBook.js:867).
  pathParamsSchema: pathParamSchema('kpostId'),
  request: () => ({
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
  }),
});

export const kbookingApis: EndpointDefinition[] = [
  citySuggestionApi,
  destinationsApi,
  availableTripsApi,
  tripDetailsApi,
  boardingPointApi,
  tripDetailsV2Api,
  updateCityListApi,
  blockTicketApi,
];
