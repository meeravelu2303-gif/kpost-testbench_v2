import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the KBooking standalone reads (city autocomplete, destinations, available trips),
 * all on live. HOW is owned by the central validation engine.
 */
test.describe('KPost KBooking · reads', { tag: ['@api', '@verticals', '@regression'] }, () => {
  describeEndpointCases({ tags: ['kbooking-read'] });
});
