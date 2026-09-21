import { providedIdentityValues, testData } from '@config/test-data.config';
import { ownsResource } from '../test-data/owned-resources';
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
 * A third case sits between the two: a **runtime** resource id (a message this run just sent) is a
 * real resource, so exempting its field would be wrong, yet its value cannot be written into `.env`
 * in advance. Those fields are listed in `RUNTIME_RESOURCE_FIELD` and checked against what the
 * resource ledger says this run created — owned ids pass, a stranger's id under the same key does
 * not. That is what lets the Katchup cleanup delete its own messages without opening `messageIds`
 * to every id in the database.
 *
 * It applies to EVERY real host — the live app and the test deployments alike (see
 * `targetsRealHost` in endpoint-executor.ts). A disposable test DB is still shared with the
 * developers and other QA accounts, and the owner's standing rule is that the bench never touches a
 * record it does not own. Only the bundled mock (and the bench's own mock fixtures) is exempt: there,
 * fuzzing ids is exactly what the bench is for, and the ids name nothing real.
 *
 * Multipart form fields (including JSON carried inside a `text` field) and JSON raw bodies are
 * inspected too; a non-JSON raw body carries no key to judge by and is not.
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
    /*
     * The LIST form of the same account tier, sent by the KDirectory search
     * (`contacts/globalSearch` → `userTypeList: ['personal']`). Identical values to `usertype`
     * above, matching the pattern for the identical reason — the key contains "user". Its siblings
     * in that payload (`languageList`, `countryList`) carry no identifier token and were never
     * checked, so the singular being exempt while the plural was not simply refused a cleared read.
     */
    'usertypelist',
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
    /*
     * KMail runtime ids — a mail we sent, its transaction rows, a draft, a saluation/template we
     * created. Runtime-scoped like a msgID, cannot be pre-allowlisted, and no productionSafe endpoint
     * accepts a real one (id-keyed KMail reads are blocked `needs-id`). The tenant identifiers in a
     * mail payload — the `selectedContact`/`toAddress`/recipient kpostIDs — stay checked.
     */
    'kmailid',
    'kmailids',
    'kmailnumber',
    'transactionids',
    'draftmailid',
    'draftkmailid',
    'saluationid',
    'templateid',
    // KMail content/enum/meta fields that match only via the "mail"/"msg"/"attachment" token — a
    // subject, a body, a send timestamp, a type/priority/flag — not tenant resources.
    'kmailstatusflag',
    'msgtotranslate',
    'kmailsubject',
    'kmailcontent',
    'kmailsenddate',
    'kmailtype',
    'kmailsendtype',
    /*
     * Which VIEW of the thread to fetch (`'A'`), from `Kmail.js getKmailChat`. A one-letter type
     * code, not a mail and not an account — it matches only because the key contains "mail", the
     * same over-match as `kmailType` beside it.
     */
    'fetchmailtype',
    'attachmentflag',
    'attachmentcaption',
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
    /*
     * An S3 attachment uuid we generated (`generate-presigned-url` mints it) — runtime-scoped like a
     * msgID/docId, cannot be pre-allowlisted, and no productionSafe endpoint accepts one (every
     * attachment op is gated / needs-attachment). `attachmentsuuid` is the array form.
     */
    'uuid',
    'attachmentsuuid',
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

/**
 * Keys whose value is a **runtime resource id**, checked against what this run actually created.
 *
 * The third answer to a problem that previously had only two bad ones. A runtime id — a message the
 * API minted when we sent it — cannot be pre-allowlisted in `.env`, so the guard would refuse it; the
 * only escape was to put the whole field in `NOT_A_RESOURCE` (as `msgid`/`kallid`/`groupid` are), and
 * that switches the check off for the field entirely, admitting a stranger's id under the same key.
 *
 * A field listed here keeps its protection instead: its value is allowed only when the resource
 * ledger says THIS RUN created it, under one of the kinds named. A foreign id is still refused, and
 * an array naming one owned and one foreign id is refused on the foreign element — so a payload
 * cannot smuggle a stranger's record in beside one of ours.
 *
 * `messageIds` is the plural field `katchup-delete-message` really takes (`{messageIds:[…],
 * groupFlag}` — the shape the live client sends, `manage.api.ts`). Singular `msgID` and the other
 * message-scoped keys keep their existing `NOT_A_RESOURCE` treatment; nothing about them changes.
 */
const RUNTIME_RESOURCE_FIELD = new Map<string, readonly string[]>([
  ['messageids', ['katchup-message']],
]);

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
    /*
     * The reserved REGISTRATION identity (OTP_TEST_GATEWAY, disposable test DB). A signup creates a
     * brand-new account — it names no existing user — and these values are ours to use, so they are
     * allowlisted like the absent fixtures. Off the test env the OTP flows are blocked upstream anyway.
     */
    testData.signupKpostId,
    testData.signupMobile,
    // `0` = the "no specific company" sentinel some public lookups require (e.g. mobileNoExist's
    // companyID for a personal check). It names no real company, so it is safe to allowlist.
    '0',
  ];
  return new Set(owned.map((value) => String(value).trim().toLowerCase()).filter(Boolean));
}

interface Offence {
  path: string;
  value: unknown;
}

/**
 * Whether this one value is ours: a `QA_*` identity from `.env`, or — for a runtime-id field — a
 * resource this run created and holds in its ledger. Anything else is somebody else's.
 */
function isOwnedValue(key: string, value: string | number, owned: Set<string>): boolean {
  if (owned.has(String(value).trim().toLowerCase())) return true;
  const kinds = RUNTIME_RESOURCE_FIELD.get(key.toLowerCase());
  return kinds !== undefined && kinds.some((kind) => ownsResource(kind, value));
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
        if (!isOwnedValue(key, value, owned)) found.push({ path: here, value });
      } else if (isIdentifier && Array.isArray(value)) {
        // `{"kallIds":[2,3]}` and `{"memberKpostIdList":[…]}` — each element is a target.
        value.forEach((item, index) => {
          if (typeof item === 'string' || typeof item === 'number') {
            if (!isOwnedValue(key, item, owned)) {
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
  /** Form fields of a multipart request; a file part (an object with a buffer) is not inspected. */
  multipart?: Record<string, unknown>;
  /** A body sent verbatim; inspected when it is a JSON object or array. */
  rawBody?: string;
}

/** A JSON object/array carried inside a string (a multipart `text` field, a raw body), or undefined. */
function embeddedJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Multipart form fields. The company-logo upload carries its ids as JSON inside a `text` field
 * (`text={"companyID":4}`), so a field whose value is embedded JSON is walked like a body; a plain
 * string field is checked under its own key; a file part is skipped (bytes, not identifiers).
 */
function walkMultipart(
  multipart: Record<string, unknown>,
  owned: Set<string>,
  found: Offence[],
): void {
  for (const [key, value] of Object.entries(multipart)) {
    if (typeof value === 'string') {
      const json = embeddedJson(value);
      if (json !== undefined) walk(json, `multipart.${key}`, owned, found);
      else walk({ [key]: value }, 'multipart', owned, found);
    } else if (typeof value === 'number') {
      walk({ [key]: value }, 'multipart', owned, found);
    }
  }
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
  if (request.multipart) walkMultipart(request.multipart, owned, found);
  // A raw body that is not JSON (plain text, malformed-JSON probes) carries no key to judge by.
  if (request.rawBody !== undefined) walk(embeddedJson(request.rawBody), 'rawBody', owned, found);
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
  targetsRealHost: boolean,
): void {
  if (!targetsRealHost) return;

  const foreign = foreignIdentifiers(request);
  if (!foreign.length) return;

  const detail = foreign
    .slice(0, 8)
    .map((offence) => `  ${offence.path} = ${JSON.stringify(offence.value)}`)
    .join('\n');
  const more = foreign.length > 8 ? `\n  …and ${foreign.length - 8} more` : '';

  throw new ProductionSafetyError(
    `${label}: refusing to send a request to a real KPost host that names ` +
      `${foreign.length} identifier(s) we do not own:\n${detail}${more}\n` +
      `Every identifier must be a QA_* value from .env, or — for a runtime-id field — a resource ` +
      `this run created and tracked in its ledger (see RUNTIME_RESOURCE_FIELD). If one of these ` +
      `is legitimately not a resource identifier, add it to NOT_A_RESOURCE in ` +
      `qa-identifier-guard.ts with a reason.`,
  );
}
