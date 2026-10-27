import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the KBooking trip-detail (v1, v2) and boarding-point reads; the placeholder id
 * exercises the not-found path. HOW is owned by the central validation engine. block-ticket is left
 * out: it holds a real seat at the booking partner.
 */
test.describe('KPost KBooking · details', { tag: ['@api', '@verticals', '@regression'] }, () => {
  describeEndpointCases({
    ids: ['kbooking-trip-details', 'kbooking-trip-details-v2', 'kbooking-boarding-point'],
  });
});
