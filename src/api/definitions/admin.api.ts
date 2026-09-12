import type { EndpointDefinition } from '../registry/endpoint-definition';

/**
 * Admin module — a separate repository and service, maintained by Jaganathan Murthy.
 * Its defects file into the `KPost Admin` Bugzilla product.
 *
 * No endpoints yet, and deliberately so: the Admin module is **not in the KPost API workbook**,
 * which is the authoritative contract, and its swagger file was removed for being unreliable.
 * Guessing endpoints from an untrusted spec produces failures that blame the API for the
 * document. Add definitions here (or a contract for the module) when one exists.
 */
export const adminApis: EndpointDefinition[] = [];
