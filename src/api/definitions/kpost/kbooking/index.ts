import { contractPaths } from '../../../contract/workbook-contract';
import { kbookingApis } from './kbooking.api';

/** The KPost KBooking module — `/redbus/*`, the RedBus bus-search-and-booking feature. */
export { kbookingApis };

/**
 * Documented `/redbus` paths no definition covers.
 *
 * `bookticket`, `cancelticket`, `getTicket`, `checkBookedTicket`, `tripdetailsV2`, `boardingPoint`,
 * `updatecitylist` are expected here — confirmed real and frontend-active (where applicable) but
 * NOT in the Excel-workbook-generated contract this suite is built from, so they cannot be defined
 * via `defineKpostEndpoint` without the workbook owner adding them first (see kbooking.api.ts's own
 * header for the full explanation). This list exists so that gap stays visible and measured, not
 * silently dropped.
 */
export function uncoveredKBookingPaths(): string[] {
  // Use contractPath where set (citysuggestion's workbook entry bakes in a literal sample city
  // rather than a {query} template) so this comparison matches the same key workbookContract() uses.
  const covered = new Set(
    kbookingApis.map((api) => `${api.method} ${api.contractPath ?? api.path}`),
  );
  return contractPaths('kpost-api')
    .filter((path) => /^\/redbus\//i.test(path))
    .filter((path) => ![...covered].some((key) => key.endsWith(` ${path}`)));
}
