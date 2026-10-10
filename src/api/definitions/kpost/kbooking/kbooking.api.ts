import { testData } from '@config/test-data.config';
import { body, pathParams } from '../kpost-endpoint';
import { defineKpostEndpoint, type KpostEndpointConfig } from '../kpost-endpoint';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';

/**
 * The KPost **KBooking** module — `/redbus/*`, the bus-search-and-booking feature backed by the
 * RedBus/SeatSeller third-party integration.
 *
 * ## Why this module exists now (2026-10-02 scope rebuild)
 *
 * Earlier audits this session treated the whole module as "scope undecided, pending the owner" —
 * that was wrong. The frontend-call-tracing agent confirmed every one of `KBook.js`'s search/booking
 * calls has a real, live caller — per the Category-A rule ("if the frontend actually calls it, it
 * must be tested"), this is now mandatory, not deferred. Only the PAYMENT path stays blocked, and for
 * a specific, proven reason (§16 P0 of the plan): the frontend's Razorpay key is hardcoded live with
 * no `rzp_test_` counterpart anywhere in either the frontend or backend source.
 *
 * ## Payloads — measured from the real frontend, not guessed
 *
 * Every body shape below was read directly from `KBook.js`'s actual call sites (not just the
 * `Services/KBooking.js` wrapper, which just forwards an opaque `body`) and cross-checked against
 * `openapi/kpost-api.openapi.json`'s own Excel-workbook-derived schema for the same path — both
 * agree exactly (`sourceCityID`, `destinationCityID`, `travelDate`, `tripID`).
 *
 * ## What is deliberately NOT here
 *
 * `bookticket`, `cancelticket`, `getTicket`, `checkBookedTicket` are REAL, confirmed-active backend
 * endpoints (confirmed both from the `RedBusIntegrationController.java` source audit and the
 * frontend trace — `KBook.js` calls `BookTicket`/`CancelTicket`/`FetchTickets`) but are **not
 * documented in the Excel workbook that is this suite's contract source of truth** —
 * `workbookContract()` throws for any path the generated `openapi/kpost-api.openapi.json` doesn't
 * list, and none of these four appear in it (confirmed by direct search). This is a genuine external
 * blocker, not a shortcut: adding them requires the workbook owner to document the real payload
 * shapes (this session already has them, measured from `KBook.js`, ready to hand over), not a
 * unilateral edit to a generated contract file. `blockTicket` IS in the workbook (`{kpostId}` path
 * param) and is included below; it is gated, not `productionSafe`, since it places a real (if
 * SeatSeller-labelled "Test Credentials") hold on third-party bus inventory.
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
});

export const availableTripsApi = defineKBookingEndpoint({
  id: 'kbooking-available-trips',
  method: 'POST',
  path: '/redbus/availabletrips/',
  summary: 'Available bus trips between two cities on a date',
  tags: ['kbooking-read'],
  destructive: false,
  productionSafe: true,
  // Real shape, KBook.js:436-445 — sourceCityID/destinationCityID/travelDate. The date must be today
  // or later: the server forwards to a bus-booking partner that answers 500 for any past date, and
  // a hard-coded 2024 date made every run report that partner error as a product defect (#1063, #1067).
  request: body(() => ({
    sourceCityID: '102',
    destinationCityID: 104,
    travelDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  })),
});

export const tripDetailsApi = defineKBookingEndpoint({
  id: 'kbooking-trip-details',
  method: 'POST',
  path: '/redbus/tripdetails/',
  summary: 'Seat layout and fare details for one trip',
  tags: ['needs-id'],
  destructive: false,
  // Needs a real tripID minted by a prior availabletrips search — a placeholder 4xxs/empties, not a
  // genuine standalone read. KBook.js:579 — `FetchTripDetails({ tripID: key })`.
  productionSafe: false,
  note: 'needs a real tripID from a prior availabletrips search; a placeholder id is not meaningful',
  request: body(() => ({ tripID: '5000035149644122223' })),
});

export const blockTicketApi = defineKBookingEndpoint({
  id: 'kbooking-block-ticket',
  method: 'POST',
  path: '/redbus/blockTicket/{kpostId}',
  summary: 'Hold seats on a trip pending payment (pre-payment step)',
  tags: ['needs-id', 'critical'],
  destructive: true,
  // Places a real (if sandbox-credentialed) hold on third-party bus inventory — gated behind an
  // explicit lifecycle flag, same pattern as every other real-world-effecting write in this suite.
  // KBook.js:845-867 — full passenger/fare payload, kpostID as a path param.
  productionSafe: false,
  // Unconditionally skipped in feature.spec.ts (not gated behind an env flag) — places a real
  // third-party seat hold and the SeatSeller "Test Credentials" label is not confirmed to be a true
  // sandbox, so this needs explicit owner authorization before ANY live execution, the same standing
  // as the Razorpay payment path and the OTP-bypass flag. No env var controls this; do not add one
  // without that authorization first.
  note: 'WRITTEN, EXECUTION BLOCKED pending explicit owner authorization — real third-party seat hold, unconfirmed sandbox (see feature.spec.ts)',
  // Needs both a body AND a path param (kpostId) — neither `body()` nor `pathParams()` alone covers
  // that, so this is an inline RequestFactory combining both, matching the real call shape exactly.
  // kpostId is the CALLER'S OWN kpost account id — KBook.js:867 passes `User.kpostID` (the logged-in
  // user's own identifier, read from their session), not a booking/order resource id.
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
  blockTicketApi,
];
