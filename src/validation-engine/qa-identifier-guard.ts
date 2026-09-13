import { providedIdentityValues, testData } from '@config/test-data.config';
import { ProductionSafetyError } from './production-guard';

/**
 * Refuses any request to the live application that names a resource we do not own.
 *
 * ## The hole this closes
 *
 * Restricting a live run to "our own QA accounts" sounds sufficient and is not, because several
 * KPost endpoints take the record they act on **from the request payload rather than from the
 * token**. That is measured, not assumed: `POST /admin/removeCompanyLogo` accepts
 * `{"companyId": 4}` and our tokens carry no `companyID` claim at all, so the endpoint has no way
 * to scope itself to the caller. The same shape appears across the API:
 *
 *     admin/resetPassword          {"kpostID":"priya@rkveg.kpost.in","companyID":1,…}
 *     v2/group/removeGroupMember   {"memberKpostIdList":["jitendra9@kpostindia.com"],"groupID":1141}
 *     v2/contacts/deleteContact    {"contactID":"prakas168@kpostindia.com"}
 *
 * Logging in as a QA account constrains none of those. Only inspecting the outgoing payload does.
 * The **tenant** identifiers above (a kpostID, a company, a contact) are what the guard checks; the
 * **runtime-scoped** ids a payload also carries — a `msgID` we sent, a `groupID` we made, a `kallID`
 * we placed — are exempt below, because they are created at runtime (so cannot be pre-allowlisted)
 * and no `productionSafe` endpoint accepts one. See `NOT_A_RESOURCE`.
 *
 * The immediate danger is the negative probes: `request.data-type` and `request.boundary-value`
 * mutate every field, id fields included, so a fuzzer turns `companyID: 1001605` into `0`, `-1` or
 * `1001604` — a real customer. On dev that is the point. On live it is damage nobody would notice,
 * because one deleted record surfaces weeks later as a support ticket that never gets traced back.
 *
 * ## How it decides
 *
 * Broad detection, explicit exemption. Any key that *looks* like a resource identifier is checked
 * against the QA allowlist, and keys that are legitimately not user-owned resources are listed by
 * name in `NOT_A_RESOURCE` below. That way a new id field added to a payload is guarded by default
 * and the burden falls on whoever exempts it — the reverse arrangement silently admits every field
 * nobody thought about.
 *
 * Off production this is inert: fuzzing ids is exactly what the bench is for.
 */

/**
 * Keys that match the identifier pattern but do not name a record belonging to a user.
 *
 * Every entry is a claim that mutating this value cannot affect another tenant. Reference data
 * (`countryID`), values we generate ourselves (`sessionID`, `deviceID`) and protocol fields
 * (`statusCode`) qualify. **A resource id never belongs here** — if an endpoint acts on it, it
 * belongs in the allowlist instead, with a QA-owned value.
 */
const NOT_A_RESOURCE = new Set(
  [
    // Reference data: shared, read-only, identical for every tenant.
    'countryid',
    'stateid',
    'regionid',
    'cityid',
    'languageid',
    'designationid',
    'pincode',
    'productid',
    'moduleid',
    'module',
    /*
     * An account TIER (PERSONAL, BUSINESS_S/M/L), not an account. It matches the pattern only
     * because it contains "user" — and treating it as an identifier refused every login on live,
     * since `loginRO.userType: "PERSONAL"` is not a QA-owned value. Found before the first run.
     */
    'usertype',
    // Values this bench generates for itself.
    'sessionid',
    'deviceid',
    'deviceidentity_primary',
    'deviceidentity_secondary',
    'requestid',
    'correlationid',
    'traceid',
    // Protocol and envelope fields, never a resource.
    'statuscode',
    'id_token',
    /*
     * Message CONTENT, TYPE codes and TIMESTAMPS — not a tenant resource. They match the pattern
     * only because a key contains "message"/"member"/"mail"; their values are body text, an enum
     * code or an epoch, and none addresses another account. Without these the guard refused every
     * Katchup send (found on the first feature run).
     */
    'messagetype',
    'actualmessage',
    'messagetime',
    'servertime',
    'sharedtype',
    'selectedmembers',
    'isvoicemessage',
    'attachmentcaption',
    'referencemessagelist',
    'referencemessageidlist',
    'sharedmessagedetails',
    'groupkpostname',
    'memberdesignation',
    'reportid',
    // Group metadata flags/paths — contain "group" but are booleans/paths, not a group id.
    'isprivategroup',
    'groupcreateaccess',
    'grouppicturepath',
    'groupflag',
    'groupforwardlist',
    /*
     * MESSAGE- and GROUP-scoped ids (a message we sent, a group we made) — not TENANT-scoped like a
     * kpostID/companyID. They are created at runtime so cannot be pre-allowlisted, and no
     * productionSafe endpoint accepts one (the id-keyed reads are all blocked on live). The
     * cross-tenant identifiers that matter — kpostID, mobile, email, company, contact, and the
     * kpostID lists — are still checked.
     */
    'msgid',
    'msgids',
    'temporarymsgid',
    'oldmsgid',
    'sourcemsgid',
    'firstmsgid',
    'lastmsgid',
    'sharedmessageid',
    'groupid',
    // The auto-minted id of a group we created (`qab###@kpostindia.com`) — group-scoped and created
    // at runtime like `groupid`, so it cannot be pre-allowlisted; no productionSafe endpoint accepts
    // one (every group op is gated). The tenant ids in a group payload — the member kpostIDs — stay
    // checked.
    'groupkpostid',
    /*
     * KALL enum codes, the bench-generated session string, and the call timestamps. They match the
     * pattern only because the key contains "kall"; their values are an enum (`kallMode: 0`,
     * `kallStatus: 6`, `kallType: 1`), a session string we mint, or an epoch — none addresses another
     * account. Without these the guard refuses every Kall read on live (the same class as the Katchup
     * content fields above).
     */
    'kallsession',
    'kallmode',
    'kallstatus',
    'kalltype',
    'kallstarttime',
    'kallendtime',
    /*
     * A kall is a runtime-created, kall-scoped resource (a call we placed or scheduled), not a
     * TENANT resource like a kpostID/company. Its id cannot be pre-allowlisted, and no productionSafe
     * endpoint accepts one — every kallID-keyed read (`getKallStatus`, `getKallStatusUsingKallID`) is
     * blocked on live (`needs-kall-id`), and every write that acts on a kallID is gated. The
     * cross-tenant identifiers a kall payload also carries — the participant kpostIDs in
     * `addingUserIds`/`removingUserIds`/`kallDetails[].receiver` — are still checked.
     */
    'kallid',
    'kallids',
    /*
     * The id of a KWord document we created (a UUID). Doc-scoped and created at runtime like a
     * groupID/msgID, so it cannot be pre-allowlisted; no productionSafe endpoint accepts one (every
     * KWord op is gated). The tenant kpostIDs in a doc's share/join payload stay checked.
     */
    'docid',
    // KWord document CONTENT/TYPE fields — a title, a subject line, a document-type name — not
    // resources. They match only because the key contains "doc"/"document".
    'doctitle',
    'titleofdocument',
    'documenttype',
    /*
     * Appearance/preference values on the theme write (`changeTheme`). They match the pattern only
     * because the key contains "katchup"/"kpost"; their values are a style name (`bubble`), a colour
     * theme (`sunset`) or a layout (`purple`) — a cosmetic setting on the caller's own account, not a
     * tenant resource. Without these the guard refuses the theme write.
     */
    'katchupchatstyle',
    'katchupchattheme',
    'katchupchatbackgroundthemewallpaper',
    'kpostlayouttheme',
    /*
     * A **bare** `id` — the row id of the resource, echoed back in a write body (`updateKallStatus`,
     * `joinScheduleKall`, `endKoolKall` all send `{id: <the kall we created>, kallID: <same>}`). It
     * is the same runtime-scoped kall id as `kallID`, just under the primary-key name. Exempting the
     * EXACT key `id` is surgical: this API names every cross-tenant target with a QUALIFIED key
     * (`kpostID`, `companyID`, `contactID`, `groupID`, `kallID`, `msgID`), never a bare `id`, and no
     * `productionSafe` endpoint sends one (asserted below and by the kall coverage self-test). A
     * qualified `…id` key such as `companyid`/`kpostid` is unaffected — only exact `id` matches here.
     */
    'id',
    // The plural of a bare `id`: a runtime row-id array (`addOrRemoveAdminAccess` sends `ids:[…]` of
    // membership rows). Same surgical exemption as `id` — qualified keys (`kpostIDs`, `contactIDs`)
    // stay checked.
    'ids',
  ].map((key) => key.toLowerCase()),
);

/** Keys whose value names a record that could belong to somebody else. */
const IDENTIFIER_KEY =
  /(^|[^a-z])(id|ids)$|kpost|mobile|email|company|contact|group|member|msg|message|kall|katchup|mail|doc|presentation|attachment|uuid|account|user/i;

/**
 * Every QA-owned identifier, lower-cased and stringified for comparison.
 *
 * Built from values **explicitly set in `.env`** — never from a schema default. Those defaults are
 * the mock server's seed, and `companyId` defaults to `1`, which is a real company on the live
 * application: allowlisting it would turn this guard into the thing that authorises the damage.
 *
 * The consequence is deliberate and useful. While no business account exists on live, the business
 * identifiers are unset, so nothing company-shaped is in the allowlist and every request naming a
 * company is refused. A PERSONAL-only scope enforces itself.
 */
function qaOwnedValues(): Set<string> {
  const owned = [
    ...providedIdentityValues(),
    /*
     * The "absent" fixtures are the exception: they are required to match NOTHING, so they cannot
     * name anybody's record, and the enumeration probes need them. Their defaults are safe for the
     * same reason — an id that exists nowhere belongs to no one.
     */
    testData.kpostIdAbsent,
    testData.mobileAbsent,
    testData.companyNameAbsent,
  ];
  return new Set(owned.map((value) => String(value).trim().toLowerCase()).filter(Boolean));
}

interface Offence {
  path: string;
  value: unknown;
}

function walk(node: unknown, trail: string, owned: Set<string>, found: Offence[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, `${trail}[${index}]`, owned, found));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      const here = trail ? `${trail}.${key}` : key;
      const isIdentifier = IDENTIFIER_KEY.test(key) && !NOT_A_RESOURCE.has(key.toLowerCase());

      if (isIdentifier && (typeof value === 'string' || typeof value === 'number')) {
        if (!owned.has(String(value).trim().toLowerCase())) found.push({ path: here, value });
      } else if (isIdentifier && Array.isArray(value)) {
        // `{"kallIds":[2,3]}` and `{"memberKpostIdList":[…]}` — each element is a target.
        value.forEach((item, index) => {
          if (typeof item === 'string' || typeof item === 'number') {
            if (!owned.has(String(item).trim().toLowerCase())) {
              found.push({ path: `${here}[${index}]`, value: item });
            }
          } else {
            walk(item, `${here}[${index}]`, owned, found);
          }
        });
      } else {
        walk(value, here, owned, found);
      }
    }
    return;
  }
}

export interface GuardedRequest {
  body?: unknown;
  query?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
}

/**
 * Identifiers in this request that are not ours, or an empty list when every one is.
 *
 * Separated from the throwing wrapper so a test can assert on the findings without catching.
 */
export function foreignIdentifiers(request: GuardedRequest): Offence[] {
  const owned = qaOwnedValues();
  const found: Offence[] = [];
  walk(request.body, 'body', owned, found);
  walk(request.query, 'query', owned, found);
  walk(request.pathParams, 'path', owned, found);
  return found;
}

/**
 * Throws when a live request names a record we do not own. Call before the request is sent.
 *
 * Deliberately a hard failure rather than a skip: reaching this point means a validator tried to
 * fuzz an identifier against the live application, and that is a bug in the run's configuration,
 * not a property of the endpoint. It must stop the run and be read by a human.
 */
export function assertQaOwnedIdentifiers(
  request: GuardedRequest,
  label: string,
  isProduction: boolean,
): void {
  if (!isProduction) return;

  const foreign = foreignIdentifiers(request);
  if (!foreign.length) return;

  const detail = foreign
    .slice(0, 8)
    .map((offence) => `  ${offence.path} = ${JSON.stringify(offence.value)}`)
    .join('\n');
  const more = foreign.length > 8 ? `\n  …and ${foreign.length - 8} more` : '';

  throw new ProductionSafetyError(
    `${label}: refusing to send a request to the LIVE application that names ` +
      `${foreign.length} identifier(s) we do not own:\n${detail}${more}\n` +
      `Every identifier must be a QA_* value from .env. If one of these is legitimately not a ` +
      `resource identifier, add it to NOT_A_RESOURCE in qa-identifier-guard.ts with a reason.`,
  );
}
