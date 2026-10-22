import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the KBooking trip-detail reads (v1, v2) and the boarding-point read, which take ids
 * minted by a prior search (the feature chain feeds them real ones).
 * HOW is owned by the central validation engine; the placeholder id exercises the not-found path.
 * `kbooking-block-ticket` is deliberately left out: a successful call holds a seat at the booking
 * partner, a real external side effect (see tests/framework/sweep-completeness.spec.ts).
 */
test.describe('KPost KBooking · details', { tag: ['@api', '@verticals', '@regression'] }, () => {
  describeEndpointCases({
    ids: ['kbooking-trip-details', 'kbooking-trip-details-v2', 'kbooking-boarding-point'],
  });
});
