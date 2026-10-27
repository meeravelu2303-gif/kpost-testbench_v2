import { contractPaths } from '../../../contract/workbook-contract';
import { kbookingApis } from './kbooking.api';

/** The KPost KBooking module — `/redbus/*`, the RedBus bus-search-and-booking feature. */
export { kbookingApis };

/** Documented `/redbus` paths no definition covers. */
export function uncoveredKBookingPaths(): string[] {
  // Match on contractPath where set, the same key workbookContract() uses.
  const covered = new Set(
    kbookingApis.map((api) => `${api.method} ${api.contractPath ?? api.path}`),
  );
  return contractPaths('kpost-api')
    .filter((path) => /^\/redbus\//i.test(path))
    .filter((path) => ![...covered].some((key) => key.endsWith(` ${path}`)));
}
