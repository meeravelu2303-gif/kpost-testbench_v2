import type { EndpointDefinition } from '../registry/endpoint-definition';

/**
 * KMail module — a separate repository and a separate service, maintained by Jitendra Kumar.
 * Its defects file into the `KMail API` Bugzilla product and are assigned to him automatically.
 *
 * ## Not in scope yet — deliberately empty
 *
 * The agreed order of work is one module at a time: **common, then Signup & Login**. KMail comes
 * later.
 *
 * This file used to auto-load endpoints from `openapi/kmail-api.openapi.json` as soon as
 * `KMAIL_API_BASE_URL` was set. Configuring that host for reference then silently registered 15
 * endpoints and 660 validation cases — work nobody asked for, counted in the totals alongside the
 * tests that were actually written, and misleading about what the bench covers. Registration is now
 * an explicit decision rather than a side effect of setting an environment variable.
 *
 * ## Turning it on, when KMail is the module being built
 *
 * Restore the loader below. The groundwork it needs is already in place and was worth keeping:
 *
 *   - `RESPONSE_CONTRACTS.kmail` — KMail's envelope is a third shape: the payload sits under
 *     `value`, and there is no `statusCode` (measured across its 26 documented responses).
 *   - `loadModuleEndpoints` accepts `responseContract`, `authentication` and `tags`.
 *   - KMail enforces authentication: `GET /common/getSaluations/` answers 403 with an empty body,
 *     which nothing in the workbook mentions. Signup & Login can now issue the token it needs.
 *
 *     export const kmailApis: EndpointDefinition[] = env.KMAIL_API_BASE_URL
 *       ? loadModuleEndpoints(suiteFor('kmail-api'), {
 *           responseContract: 'kmail',
 *           authentication: { required: true },
 *         })
 *       : [];
 *
 * Hand-written definitions with request factories — the way `kpost/common` and
 * `kpost/signup-login` are built — are the better shape for it, since the spec cannot supply
 * payloads for anything but parameterless GETs.
 */
export const kmailApis: EndpointDefinition[] = [];
