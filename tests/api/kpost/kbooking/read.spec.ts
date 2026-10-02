import { describeEndpointCases } from '@engine/endpoint-cases';
import { test } from '@fixtures';

/**
 * WHAT is tested: the KBooking standalone reads — city autocomplete, destination lookup, and
 * available-trips search. HOW is owned by the central validation engine. All three run on live;
 * none need a prior runtime id (unlike `tripDetails`, which needs a real `tripID` from a search
 * and is exercised in `feature.spec.ts` instead).
 */
test.describe('KPost KBooking · reads', () => {
  describeEndpointCases({ tags: ['kbooking-read'] });
});
