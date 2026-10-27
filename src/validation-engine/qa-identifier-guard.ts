import { providedIdentityValues, testData } from '@config/test-data.config';
import { allRegisteredKpostIds } from '@fixtures/test-accounts';
import { ProductionSafetyError } from './production-guard';

/**
 * Refuses any live request that names a resource we do not own. Several endpoints take the target
 * record from the payload, not the token, so a fuzzed id (`companyID: 1001604`) could hit a real
 * customer. Any key that looks like an identifier is checked unless exempted in `NOT_A_RESOURCE`,
 * so new id fields are guarded by default. Inert off production.
 */

/**
 * Keys that match the identifier pattern but cannot affect another tenant (reference data,
 * bench-generated values, content, runtime-scoped ids). A tenant resource id never belongs here.
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
    // An account tier (PERSONAL, BUSINESS_*), not an account; plural is the directory filter.
    'usertype',
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
    // Message content, enum codes, settings, search text and timestamps: never another account.
    'messagetype',
    'actualmessage',
    'message preview',
    'messageby',
    'searchmessage',
    'messagetime',
    'servertime',
    'secretmessageexpiretime',
    'sharedtype',
    'selectedmembers',
    'isvoicemessage',
    'attachmentcaption',
    'referencemessagelist',
    'referencemessageidlist',
    'sharedmessagedetails',
    'groupkpostname',
    // Display names and counts a user types, not resource ids.
    'groupname',
    'contactname',
    'memberdesignation',
    'maximummemberscount',
    'reportid',
    // Group metadata flags/paths — contain "group" but are booleans/paths, not a group id.
    'isprivategroup',
    'groupcreateaccess',
    'grouppicturepath',
    'groupflag',
    'groupforwardlist',
    /*
     * Runtime-scoped message ids (a message we sent): cannot be pre-allowlisted, and no
     * productionSafe endpoint accepts one. Tenant identifiers (kpostID, mobile, email, company,
     * contact) stay checked.
     */
    'msgid',
    'msgids',
    'messageid',
    'messageids',
    'forwardmessageidlist',
    'temporarymsgid',
    'oldmsgid',
    'sourcemsgid',
    'firstmsgid',
    'lastmsgid',
    'sharedmessageid',
    // KMail runtime ids (a mail, draft, template we created); recipient kpostIDs stay checked.
    'kmailid',
    'kmailids',
    'kmailnumber',
    'transactionids',
    'draftmailid',
    'draftkmailid',
    'saluationid',
    'templateid',
    // The same runtime KMail id under reply/forward key names.
    'referencekmailid',
    'referencemails',
    'originalkmailid',
    // KMail content, enum and timestamp fields, not tenant resources.
    'kmailstatusflag',
    'msgtotranslate',
    'kmailsubject',
    'kmailcontent',
    'kmailsenddate',
    'kmailtype',
    'fetchmailtype',
    'kmailsendtype',
    'attachmentflag',
    'attachmentcaption',
    'groupid',
    // A group we created (runtime-scoped, every group op is gated); member kpostIDs stay checked.
    'groupkpostid',
    // Kall enum codes, our session string and call timestamps.
    'kallsession',
    'kallmode',
    'kallstatus',
    'kalltype',
    'kallstarttime',
    'kallendtime',
    // A kall we placed (kallID reads are blocked on live); participant kpostIDs stay checked.
    'kallid',
    'kallids',
    // A KWord document we created (runtime-scoped, every KWord op is gated).
    'docid',
    // An S3 attachment uuid we generated (attachment ops are gated); Katchup and KMail spellings.
    'uuid',
    'attachmentsuuid',
    'attachmentuuid',
    // KWord document title/type fields.
    'doctitle',
    'titleofdocument',
    'documenttype',
    // Cosmetic theme settings on the caller's own account (`changeTheme`).
    'katchupchatstyle',
    'katchupchattheme',
    'katchupchatbackgroundthemewallpaper',
    'kpostlayouttheme',
    /*
     * A bare `id`/`ids`: a runtime row id echoed in a write body. Safe only as the exact key,
     * because this API names every cross-tenant target with a qualified key (`kpostID`,
     * `companyID`, …), which stays checked.
     */
    'id',
    'ids',
    // The Admin employee's postal address fields; e-mail keys stay checked.
    'mailingcountry',
    'mailingzipcode',
    'mailingstate',
    'mailingcity',
    'mailingarea',
    'mailingaddressline1',
    'mailingaddressline2',
  ].map((key) => key.toLowerCase()),
);

/** Keys whose value names a record that could belong to somebody else. */
const IDENTIFIER_KEY =
  /(^|[^a-z])(id|ids)$|kpost|mobile|email|company|contact|group|member|msg|message|kall|katchup|mail|doc|presentation|attachment|uuid|account|user/i;

/**
 * Every QA-owned identifier, lower-cased. Built only from values explicitly set in `.env`, never
 * schema defaults: the default `companyId` of `1` is a real live company.
 */
function qaOwnedValues(): Set<string> {
  const owned = [
    ...providedIdentityValues(),
    // "Absent" fixtures match nothing, so they name nobody's record.
    testData.kpostIdAbsent,
    testData.mobileAbsent,
    testData.companyNameAbsent,
    // The reserved Personal and Business registration identities: a signup names no existing user.
    testData.signupKpostId,
    testData.signupMobile,
    testData.businessSignupKpostId,
    testData.businessSignupMobile,
    testData.businessSignupCompanyName,
    testData.businessSignupUniqueName,
    /*
     * The reserved OTP destinations. Allowlisted by value, never by exempting the email key: the
     * mail server is live, and a fuzzed address would receive a real one-time code.
     */
    testData.otpEmail,
    testData.otpMobile,
    // `0` is the "no specific company" sentinel some public lookups require.
    '0',
    // Every account in the central registry: bench-owned by construction (provisioned or not).
    ...allRegisteredKpostIds(),
    // The bare (no-domain) form of each owned identity, to assert bare-name login is rejected.
    ...providedIdentityValues()
      .filter((value) => value.includes('@'))
      .map((value) => value.split('@')[0] ?? value),
    // The primary account's real mobile number (not QA_MOBILE_EXISTS), for login-by-mobile checks.
    '8122016145',
  ];
  return new Set(owned.map((value) => String(value).trim().toLowerCase()).filter(Boolean));
}

interface Offence {
  path: string;
  value: unknown;
}

/** A value names somebody else's record unless it is ours — or empty, which names nothing at all. */
const notOurs = (value: string | number, owned: Set<string>): boolean => {
  const v = String(value).trim().toLowerCase();
  return v !== '' && !owned.has(v);
};

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
        if (notOurs(value, owned)) found.push({ path: here, value });
      } else if (isIdentifier && Array.isArray(value)) {
        // `{"kallIds":[2,3]}` and `{"memberKpostIdList":[…]}` — each element is a target.
        value.forEach((item, index) => {
          if (typeof item === 'string' || typeof item === 'number') {
            if (notOurs(item, owned)) {
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

/** Identifiers in this request that are not ours (empty when every one is). */
export function foreignIdentifiers(
  request: GuardedRequest,
  minted: readonly (string | number)[] = [],
): Offence[] {
  const owned = qaOwnedValues();
  // Exact values this request's own flow just created; never a key-wide exemption.
  for (const value of minted) {
    const v = String(value).trim().toLowerCase();
    if (v) owned.add(v);
  }
  const found: Offence[] = [];
  walk(request.body, 'body', owned, found);
  walk(request.query, 'query', owned, found);
  walk(request.pathParams, 'path', owned, found);
  return found;
}

/**
 * Throws when a live request names a record we do not own. A hard failure, not a skip: it means the
 * run is misconfigured and a human must read it.
 */
export function assertQaOwnedIdentifiers(
  request: GuardedRequest,
  label: string,
  isProduction: boolean,
  minted: readonly (string | number)[] = [],
): void {
  if (!isProduction) return;

  const foreign = foreignIdentifiers(request, minted);
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
