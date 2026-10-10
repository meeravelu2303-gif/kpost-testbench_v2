import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the KBooking trip-detail read, which takes a trip id minted by a prior search.
 * HOW is owned by the central validation engine; the placeholder id exercises the not-found path.
 * `kbooking-block-ticket` is deliberately left out: a successful call holds a seat at the booking
 * partner, a real external side effect (see tests/framework/sweep-completeness.spec.ts).
 */
test.describe('KPost KBooking · details', () => {
  describeEndpointCases({ ids: ['kbooking-trip-details'] });
});
