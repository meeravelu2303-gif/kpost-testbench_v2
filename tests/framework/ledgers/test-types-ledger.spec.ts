import fs from 'node:fs';
import path from 'node:path';
import { apiRegistry } from '@api/definitions/index';
import { toJsonSchema, type ContractSchema } from '@api/schema/contract-schema';
import { ROOT_DIR } from '@config/constants';
import { DEFAULT_SUITE } from '@config/ownership.config';
import { CHECK_TYPES, type CheckType } from '@engine/check-types';
import { destructiveBlockReason, type SafetyFlags } from '@engine/production-guard';
import { noLimitReason } from '@api/contract/source-limits';
import { cannotBeARecord, isGuardedIdentifierKey } from '@engine/qa-identifier-guard';
import { resolveEndpoint, type ResolvedEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/**
 * How complete each KPost API test type is: of the endpoints a type applies to, how many the bench can
 * really check that way on the QA server. Written to docs/generated/kpost-api-type-coverage.md with the
 * gap list per type, so closing a type to 100% is a list to work through. Static (no server): it reads
 * the endpoint definitions and the hand-written specs; a live run decides pass/fail, not this ledger.
 */

const OUT = path.join(ROOT_DIR, 'docs', 'generated', 'kpost-api-type-coverage.md');
const TESTS = path.join(ROOT_DIR, 'tests', 'kpost-api');

/** The paused KDoc/KOS module is out of scope (owner, 2026-10-10). */
const inScope = () =>
  apiRegistry
    .find({ suites: [DEFAULT_SUITE] })
    .filter((d) => !(d.tags ?? []).some((t) => t.startsWith('kos-')))
    .map(resolveEndpoint);

interface Field {
  path: string;
  type: string;
  limited: boolean;
}

/** Leaf fields of a request/query/path schema, with whether a size or range limit is declared. */
function fields(schema: ContractSchema | undefined, prefix = ''): Field[] {
  if (!schema) return [];
  const walk = (node: Record<string, unknown>, at: string): Field[] => {
    const props = node.properties as Record<string, Record<string, unknown>> | undefined;
    if (props) return Object.entries(props).flatMap(([k, v]) => walk(v, at ? `${at}.${k}` : k));
    if (node.type === 'array' && node.items)
      return walk(node.items as Record<string, unknown>, `${at}[]`);
    const type = Array.isArray(node.type)
      ? node.type.join('|')
      : typeof node.type === 'string'
        ? node.type
        : 'any';
    const limited = [
      'maxLength',
      'minLength',
      'maximum',
      'minimum',
      'exclusiveMaximum',
      'exclusiveMinimum',
      'maxItems',
      'enum',
    ].some((k) => k in node);
    return at ? [{ path: at, type, limited }] : [];
  };
  return walk(toJsonSchema(schema), prefix);
}

const inputs = (e: ResolvedEndpoint): Field[] => [
  ...fields(e.requestSchema, 'body'),
  ...fields(e.querySchema, 'query'),
  ...fields(e.pathParamsSchema, 'path'),
];

/** The flags `npm run product:kpost-api` runs with (package.json). */
const PRODUCT_RUN: SafetyFlags = {
  isProduction: true,
  allowDestructive: true,
  writeFuzz: true,
  testDbMode: true,
  otpTestGateway: true,
  globalLifecycle: true,
  liveHostConfigured: false,
};

const WALLED = 'walled by owner rule (a real SMS/e-mail, or ends the running session)';

/**
 * Endpoints the guard would let through but the owner's standing rules forbid on a shared QA server
 * (CLAUDE.md §1, §3, §5): each changes state for every user, outside parties, or other accounts.
 */
const WALLED_BY_OWNER: Readonly<Record<string, string>> = {
  'common-update-flutter-app-version': 'sets the app-update prompt of every Flutter client',
  'katchup-patch-work-for-group': 'a one-off data migration only two developer ids may run',
  'profile-kmail-password-patch-work': 'resets KMail passwords; only two developer ids may run it',
  'kbooking-update-city-list': 'refreshes the RedBus city list of every user',
  'kbooking-block-ticket': 'holds a real seat at the booking partner',
  'knews-admin-feed-sync': 'changes the news feed of every user',
  'knews-admin-feed-enable': 'changes the news feed of every user',
  'knews-admin-feed-disable': 'changes the news feed of every user',
  'signup-login-business-adding-user-public':
    'overwrites any existing account (no login, no company check)',
  // Out of reach by design: no QA account or record can ever make them succeed.
  'katchup-forward-backtrack':
    'unreachable by design: only the system sender id may call it (KatchupControllerV2 forwardMessageBacktrackByMsgID)',
  'kall-legacy-set-status':
    'unreachable by design: acts on the old TBL_KPOST_KALL_TRACKERS, which no current route writes ("Kall not found" for the owner too)',
  'kall-legacy-cancel-schedule':
    'unreachable by design: acts on the old TBL_KPOST_KALL_TRACKERS, which no current route writes ("Kall not found" for the owner too)',
  'kall-legacy-remove-member':
    'unreachable by design: acts on the old TBL_KPOST_KALL_SCHEDULE_DETAILS, which no current route writes',
  // CLAUDE.md §5 rule 7: one wrong-password attempt per account per run. The engine's negative
  // probes would mutate the shared business admins' passwords many times over.
  'signup-login-admin-user-login':
    'its negative probes would send many wrong passwords for the shared business admins (rule 7: one per account per run)',
};

/**
 * Input keys that end in "id" but name no one's record, so they give a stranger nothing to reach:
 * ids the client makes up for its own request, and ids of a public catalogue every user reads alike.
 * An endpoint whose only ids are these has no object-level authorization to test (its login check is
 * the authentication type's).
 */
const NOT_A_RECORD: Readonly<Record<string, string>> = {
  sessionID: "the client's own session label (the web app sends 'Web-Reactjs')",
  temporaryMsgID: "the client's own counter for matching its send to the server's answer",
  deviceID: "the caller's own device, sent with its own phone book",
  countryID: 'the public country list',
  sourceCityID: "the booking partner's public city list",
  destinationCityID: "the booking partner's public city list",
  tripID: "the booking partner's public trip search result",
  boardingID: "the booking partner's public boarding points of a trip",
  inventoryId: "the booking partner's public trip inventory",
  categoryId: 'the public news category list',
  languageId: 'the public news language list',
  feedId: 'the public news feed list',
};

/**
 * Files the product shows to every signed-in user, with no owner rule to break: no privacy setting
 * covers them (Settings has none for photos; UserProfileControllerV2.java:1202-1368 and
 * CommonControllerV2.java:1317-1343 check no relationship). A stranger reading one is the product
 * working, so object-level authorization does not apply (whether they need a login at all is the
 * authentication type's). Owner confirmed 2026-11-05 ("yes"); remove an entry if a rule is decided.
 */
const PUBLIC_FILES: Readonly<Record<string, string>> = {
  'profile-download-image': "a user's profile photo, shown wherever their name appears",
  'profile-download-full-image': "a user's full-size profile photo, opened from that photo",
  'profile-download-cover': "a user's profile cover image, shown on their profile",
  'common-download-company-logo': "a company's logo, shown beside its members",
};

/** Why the engine may not send this endpoint's normal request in a product run, or undefined. */
function blocked(e: ResolvedEndpoint): string | undefined {
  const owner = WALLED_BY_OWNER[e.id];
  if (owner) return `${WALLED}: ${owner}`;
  const reason = destructiveBlockReason(e, PRODUCT_RUN);
  if (!reason) return undefined;
  // One line per kind, without the endpoint label the guard puts in front.
  if (/SMS kill-switch|texts/.test(reason)) return WALLED;
  if (/no productionSafe/.test(reason))
    return 'not cleared to run on the QA server (no productionSafe)';
  return reason.replace(`${e.label} `, '').replace(`${e.label}: `, '');
}

/** Hand-written specs of a type folder, read once. */
const specText = new Map<string, string>();
function handWritten(type: string): string {
  if (!specText.has(type)) {
    const dir = path.join(TESTS, type);
    const read = (d: string): string[] =>
      fs.existsSync(d)
        ? fs.readdirSync(d, { withFileTypes: true }).flatMap((x) =>
            x.isDirectory()
              ? read(path.join(d, x.name))
              : x.name.endsWith('.spec.ts') && !x.name.includes('-endpoints-')
                ? [fs.readFileSync(path.join(d, x.name), 'utf8')].filter(
                    // A spec skipped outright as BLOCKED runs nothing, so it covers nothing.
                    (src) => !/test\.skip\(\s*true,\s*['"`]BLOCKED \(whole spec\):/.test(src),
                  )
                : [],
          )
        : [];
    specText.set(type, read(dir).join('\n'));
  }
  return specText.get(type) ?? '';
}
const mentioned = (type: string, e: ResolvedEndpoint): boolean =>
  new RegExp(`['"\`\\[]${e.id}['"\`\\]]`).test(handWritten(type));

/** The wall reason when the owner rules forbid the endpoint, else undefined. */
const walledReason = (e: ResolvedEndpoint): string | undefined => {
  const why = blocked(e);
  return why?.startsWith(WALLED) ? why : undefined;
};

/** Hand-written folders whose specs drive endpoints with real data (lifecycles, rules, cross-user). */
const FLOW_TYPES = [
  'e2e',
  'business-rules',
  'data-integrity',
  'positive',
  'authentication',
  'authorization',
  'security',
  'negative',
  'boundary',
];
const drivenByFlow = (e: ResolvedEndpoint): boolean => FLOW_TYPES.some((t) => mentioned(t, e));

/**
 * Specs that run the full engine on a real record (`checkOnRealRecord`, src/validation-engine/
 * real-record.ts): an endpoint they name is reached by every engine check, sweep or not.
 */
const REAL_RECORD_SPECS = FLOW_TYPES.map(handWritten)
  .join('\n')
  .split(/^import /m)
  .filter((file) => file.includes('checkOnRealRecord('))
  .join('\n');
/** Specs that send a shared-state write's bad input themselves (`negativeInFlow`, flow-negative.ts). */
const IN_FLOW_NEGATIVE_SPECS = FLOW_TYPES.map(handWritten)
  .join('\n')
  .split(/^import /m)
  .filter((file) => file.includes('negativeInFlow('))
  .join('\n');
const negativeInFlowFor = (e: ResolvedEndpoint): boolean =>
  new RegExp(`['"\`]${e.id}['"\`]`).test(IN_FLOW_NEGATIVE_SPECS);
/** Specs that send a shared-state write's boundary values themselves (`boundaryInFlow`). */
const IN_FLOW_BOUNDARY_SPECS = FLOW_TYPES.map(handWritten)
  .join('\n')
  .split(/^import /m)
  .filter((file) => file.includes('boundaryInFlow('))
  .join('\n');
const boundaryInFlowFor = (e: ResolvedEndpoint): boolean =>
  new RegExp(`['"\`]${e.id}['"\`]`).test(IN_FLOW_BOUNDARY_SPECS);

/**
 * Ids really run through the engine on a real record: the literal id argument of a
 * `checkOnRealRecord(` call, or an id inside a `realRecordIds(` list a loop of such calls runs on. A
 * mere mention elsewhere in the same file (the flow's own calls) is not credited.
 */
const REAL_RECORD_IDS: ReadonlySet<string> = (() => {
  const ids = new Set<string>();
  for (const m of REAL_RECORD_SPECS.matchAll(
    /checkOnRealRecord\(\s*\w+,\s*['"`]([a-z0-9-]+)['"`]/g,
  ))
    ids.add(m[1]!);
  // `realRecordIds([...])` or `realRecordIds<Type>([...])`.
  for (const start of [...REAL_RECORD_SPECS.matchAll(/realRecordIds(?:<[^>()]*>)?\(/g)].map(
    (m) => m.index,
  )) {
    let depth = 0;
    let end = start;
    for (let i = start; i < REAL_RECORD_SPECS.length; i++) {
      const ch = REAL_RECORD_SPECS[i];
      if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) {
        end = i;
        break;
      }
    }
    for (const m of REAL_RECORD_SPECS.slice(start, end).matchAll(
      /['"`]([a-z][a-z0-9]*(?:-[a-z0-9]+)+)['"`]/g,
    ))
      ids.add(m[1]!);
  }
  return ids;
})();

const onRealRecord = (e: ResolvedEndpoint): boolean => REAL_RECORD_IDS.has(e.id);

/** Why the engine's checks cannot reach this endpoint: guard-blocked and no real-record run. */
const engineBlocked = (e: ResolvedEndpoint): string | undefined => {
  // CLAUDE.md §3: a shared-state (`global`) write runs only as a flow's own opted-in call, never
  // by the engine, so the engine's checks (negative, boundary, auth, security, performance) cannot
  // reach it unless the owner changes that rule.
  if (e.sideEffect === 'global' && !walledReason(e))
    return `${WALLED}: a shared-state write, which the engine never sends (CLAUDE.md §3)`;
  return onRealRecord(e) ? undefined : blocked(e);
};

/** The endpoint's own normal request, when it can be built statically (no live call needed). */
function sampleRequest(e: ResolvedEndpoint): Record<string, unknown> | undefined {
  try {
    const spec: unknown = e.definition.request?.({} as never);
    return spec && typeof spec === 'object' && !('then' in spec)
      ? (spec as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The sample request's value at a ledger field path (`body.a.b`, `body.list[].x`). */
function valueAt(spec: Record<string, unknown> | undefined, fieldPath: string): unknown {
  const [section, ...steps] = fieldPath.split('.');
  let node: unknown =
    section === 'body' ? spec?.body : section === 'query' ? spec?.query : spec?.pathParams;
  for (const step of steps) {
    if (Array.isArray(node)) node = node[0];
    node =
      node && typeof node === 'object'
        ? (node as Record<string, unknown>)[step.replace('[]', '')]
        : undefined;
    if (step.endsWith('[]') && Array.isArray(node)) node = node[0];
  }
  return node;
}

/**
 * Whether the QA guard lets the boundary validators' edge value into this field: digits for a numeric
 * field or a digits-only value (as `filler` makes them), the `qaboundary` text otherwise.
 */
function guardLetsEdge(f: Field, sample: Record<string, unknown> | undefined): boolean {
  const key = f.path.split('.').pop()?.replace('[]', '') ?? '';
  if (!isGuardedIdentifierKey(key)) return true;
  const current = valueAt(sample, f.path);
  const digits =
    /integer|number/.test(f.type) ||
    typeof current === 'number' ||
    (typeof current === 'string' && /^\d+$/.test(current));
  return cannotBeARecord(key, digits ? '9' : 'qaboundary');
}

/** Declared non-destructive (a POST read for the engine), yet they store a row: still writes here. */
const STORES_ANYWAY: Readonly<Record<string, string>> = {
  'signup-login-user-login':
    'opens a login session row (the KPOSTLogin procedure) and a history row',
  'signup-login-admin-user-login': 'opens a login session row, as userLogin does',
  'aws-generate-presigned':
    'saves the KMail attachment row (PreSignedURLServiceImpl.java:185) before the upload',
  'aws-katchup-presigned':
    'saves the Katchup attachment row (PreSignedURLServiceImpl.java:293) before the upload',
};

/**
 * Writes no client calls (checked in the React and Flutter sources): no screen, so no product rule
 * whose end result a party could see. Their security and stored-row checks still run.
 */
const NO_CLIENT: Readonly<Record<string, string>> = {
  'katchup-legacy-recall-message':
    'the pre-V2 /katchup/recallMessage; zero frontend callers (its definition, confirmed 2026-10-05)',
  'katchup-forward-message':
    'the older /v2/katchup/forwardKatchupMessage/; the web app forwards through forwardKatchupMessageNew',
  'katchup-change-caption':
    'a one-off migration (KatchupServiceImpl.captionChange) no client calls; its rewrite is checked by the stored row',
  'group-remove-member-v1-legacy':
    'the pre-V2 /group/removeGroupMember/; the web app calls /v2/group/removeGroupMember (Katchup.js:1064, ServiceURL.js:34)',
};

/** Writes that put nothing in the database (read from the source 2026-11-05), so no row to check. */
const NO_DB_WRITE: Readonly<Record<string, string>> = {
  'katchup-generate-thumbnail':
    'uploads a thumbnail to S3 in the background only (AWSs3ClientServiceImpl.java:934)',
  'profile-upload-cover': 'writes the cover image to S3 only',
  'profile-upload-image-s3': 'writes the image to S3 only',
  'profile-convert-base64': 'converts and uploads to S3 only',
  'profile-share-user-details': 'a read (its only row is the audit log entry)',
};

/**
 * Writes whose stored row a flow reads back: the literal endpoint id of an `expectStored(` call
 * (tests/support/db-stored.ts) in a hand-written spec.
 */
const DB_STORED_IDS: ReadonlySet<string> = new Set(
  [
    ...FLOW_TYPES.map(handWritten)
      .join('\n')
      // Any first argument without a comma (`db`, `databases.for('kpost-api')`).
      .matchAll(/expectStored\(\s*[^,]+,\s*['"`]([a-z0-9-]+)['"`]/g),
  ].map((m) => m[1]!),
);

/** Endpoints whose limits no request can reach today, and why (a gap, named, not a wall). */
const BOUNDARY_UNREACHABLE: Readonly<Record<string, string>> = {
  'katchup-report-abuse':
    'every call is refused before any limit: the server reads reportCode while the app and the workbook send reportID (a logged defect)',
  'katchup-forward-message':
    'the route reads only a multipart text part and no client calls it, while the boundary validators mutate JSON bodies',
};

/** Tagged as needing a real record id the engine's own request cannot supply. */
const needsRealRecord = (e: ResolvedEndpoint): boolean =>
  e.tags.some((t) => /^needs-(id|message-id|record-id|kall-id|group|attachment|doc-id)$/.test(t));

/** Boundary bookkeeping for the generated doc: endpoints with nothing to probe, guarded fields. */
const UNBOUNDED = new Set<string>();
const GUARDED_EDGES = new Set<string>();

/** The endpoint's own request is a multipart file upload. */
function takesUpload(e: ResolvedEndpoint): boolean {
  try {
    const spec: unknown = e.definition.request?.({} as never);
    const parts =
      spec && typeof spec === 'object' && 'multipart' in spec
        ? (spec as { multipart?: Record<string, unknown> }).multipart
        : undefined;
    return Object.values(parts ?? {}).some(
      (part) =>
        typeof part === 'object' &&
        part !== null &&
        Buffer.isBuffer((part as { buffer?: unknown }).buffer),
    );
  } catch {
    return false;
  }
}

const isWrite = (e: ResolvedEndpoint): boolean =>
  e.method !== 'GET' && !e.tags.some((t) => /(^|-)(read|reads|reference|search|lookup)$/.test(t));

interface Verdict {
  /** The type applies to this endpoint at all. */
  applies: boolean;
  covered: boolean;
  /** Why it is not covered (the gap to close). */
  gap?: string;
}

type Rule = (e: ResolvedEndpoint) => Verdict;
const NA: Verdict = { applies: false, covered: false };

const RULES: Record<CheckType, { means: string; rule: Rule }> = {
  positive: {
    means: 'the normal request is sent on the QA server (by the engine or by a hand-written flow)',
    rule: (e) => {
      const why = blocked(e);
      if (!why) return { applies: true, covered: true };
      return drivenByFlow(e)
        ? { applies: true, covered: true }
        : { applies: true, covered: false, gap: why };
    },
  },
  contract: {
    means: 'a documented response schema (workbook, or backend source confirmed live) is checked',
    rule: (e) =>
      !e.responseSchema
        ? {
            applies: true,
            covered: false,
            gap:
              walledReason(e) ?? 'no response schema (workbook silent, source not confirmed live)',
          }
        : !blocked(e) || drivenByFlow(e)
          ? // A flow's every successful call is checked against the schema too (endpoint-executor.ts).
            { applies: true, covered: true }
          : {
              applies: true,
              covered: false,
              gap: `schema known, but ${blocked(e)} and no flow drives it`,
            },
  },
  negative: {
    means: 'an endpoint that takes input gets bad input sent to it',
    rule: (e) => {
      if (!inputs(e).length && e.method === 'GET') return NA;
      // A shared-state write whose own flow sends its bad input (owner, 2026-11-05).
      if (!walledReason(e) && negativeInFlowFor(e)) return { applies: true, covered: true };
      const walled = walledReason(e) ?? engineBlocked(e);
      if (walled?.startsWith(WALLED)) return { applies: true, covered: false, gap: walled };
      // A file upload is fuzzed by request.multipart (no file, empty, wrong type, broken JSON part).
      if (!inputs(e).length && !takesUpload(e))
        return { applies: true, covered: false, gap: 'no request schema to mutate' };
      // A fuzzed value in a key the QA-identifier guard protects is never sent (it could name a real
      // record), so an endpoint whose every input is such a key gets no negative probe at all.
      // ...unless the fuzzer's own wrong-type value is one no record can have (cannotBeARecord).
      const fuzzable = inputs(e).filter((f) => {
        const key = f.path.split('.').pop()?.replace('[]', '') ?? '';
        const junk = /integer|number/.test(f.type) ? 'not-a-number' : 12345;
        return !isGuardedIdentifierKey(key) || cannotBeARecord(key, junk);
      });
      if (!fuzzable.length && !takesUpload(e))
        return {
          applies: true,
          covered: false,
          // Owner, 2026-11-05: mobile numbers, e-mails and company names stay protected.
          gap: `${WALLED}: every input is a mobile number, e-mail or company name the QA guard protects`,
        };
      const why = engineBlocked(e);
      return why ? { applies: true, covered: false, gap: why } : { applies: true, covered: true };
    },
  },
  boundary: {
    means: 'every text/number input has its limit (from the code or the DB column) probed',
    rule: (e) => {
      const scalar = inputs(e).filter((f) => /string|integer|number/.test(f.type));
      if (!scalar.length) return NA;
      // A field is resolved by a limit, or by a cited "no limit" (only compared, a flag, never read).
      const none = (f: Field) => Boolean(noLimitReason(DEFAULT_SUITE, e.id, f.path));
      const open = scalar.filter((f) => !f.limited && !none(f)).map((f) => f.path);
      if (open.length)
        return {
          applies: true,
          covered: false,
          gap: `no limit for ${open.slice(0, 6).join(', ')}${open.length > 6 ? ` +${open.length - 6}` : ''}`,
        };
      const limited = scalar.filter((f) => f.limited);
      if (!limited.length) {
        UNBOUNDED.add(e.id);
        return NA;
      }
      // The engine's edge value must get past the QA guard (a mobile number, e-mail, company name or a
      // numeric record id stays protected, owner 2026-11-05), or that field is never probed.
      const sample = sampleRequest(e);
      const probed = limited.filter((f) => guardLetsEdge(f, sample));
      for (const f of limited) if (!probed.includes(f)) GUARDED_EDGES.add(`${e.id} ${f.path}`);
      if (!probed.length)
        return {
          applies: true,
          covered: false,
          gap: `${WALLED}: every limited input is one the QA guard protects (${limited.map((f) => f.path).join(', ')})`,
        };
      // A shared-state write whose own flow sends its edge values (owner, 2026-11-05).
      if (e.sideEffect === 'global' && !walledReason(e) && boundaryInFlowFor(e))
        return { applies: true, covered: true };
      const why = engineBlocked(e);
      if (why) return { applies: true, covered: false, gap: why };
      // Found live 2026-11-05: an endpoint whose engine request names no real record answers 404/403/409
      // before any limit is read, so its edge values prove nothing until a flow runs the engine on a
      // real record (checkOnRealRecord).
      const unreachable = BOUNDARY_UNREACHABLE[e.id];
      if (unreachable) return { applies: true, covered: false, gap: unreachable };
      if (needsRealRecord(e) && !onRealRecord(e))
        return {
          applies: true,
          covered: false,
          gap: "the engine's request names no real record, so edge values are refused before the limit (needs a checkOnRealRecord flow)",
        };
      return { applies: true, covered: true };
    },
  },
  authentication: {
    means: 'a login-protected endpoint is sent no, forged, expired and malformed tokens',
    rule: (e) => {
      if (!e.authentication.required) return NA;
      const why = engineBlocked(e);
      return why ? { applies: true, covered: false, gap: why } : { applies: true, covered: true };
    },
  },
  authorization: {
    means:
      "an endpoint that names a record (an id) is tried by a stranger, with the owner's call as control",
    rule: (e) => {
      const ids = inputs(e).filter(
        (f) =>
          /(^|\.)\w*(id|ids|uuid|kpostid)(\[\])?$/i.test(f.path) &&
          !NOT_A_RECORD[f.path.split('.').pop()?.replace('[]', '') ?? ''],
      );
      if (!e.authentication.required || !ids.length || PUBLIC_FILES[e.id]) return NA;
      if (mentioned('authorization', e) || e.authorization.tenantScoped)
        return { applies: true, covered: true };
      const walled =
        walledReason(e) ??
        (e.sideEffect === 'external'
          ? `${WALLED}: an outside paid service per request (sideEffect 'external', always blocked)`
          : undefined);
      if (walled) return { applies: true, covered: false, gap: walled };
      return {
        applies: true,
        covered: false,
        gap: `takes ${ids
          .map((f) => f.path)
          .slice(0, 4)
          .join(', ')}; no cross-user spec names it`,
      };
    },
  },
  security: {
    means: 'injection, XSS, headers and data-exposure probes run on it',
    rule: (e) => {
      const why = engineBlocked(e);
      return why ? { applies: true, covered: false, gap: why } : { applies: true, covered: true };
    },
  },
  performance: {
    means: 'its response time and size are measured on the QA server',
    rule: (e) => {
      const why = engineBlocked(e);
      return why ? { applies: true, covered: false, gap: why } : { applies: true, covered: true };
    },
  },
  'data-integrity': {
    means: 'a write is checked in the database (a DB validation, or a DB-asserted spec)',
    rule: (e) => {
      if (!isWrite(e)) return NA;
      // A POST lookup (declared non-destructive) stores nothing, unless it is known to.
      if (e.definition.destructive === false && !STORES_ANYWAY[e.id]) return NA;
      if (NO_DB_WRITE[e.id]) return NA;
      if (e.databaseValidations.length || mentioned('data-integrity', e) || DB_STORED_IDS.has(e.id))
        return { applies: true, covered: true };
      const walled = walledReason(e);
      if (walled) return { applies: true, covered: false, gap: walled };
      return { applies: true, covered: false, gap: 'no database check of what it stored' };
    },
  },
  'business-rules': {
    means: 'a write has its product rule checked by the end result (a rule spec or a lifecycle)',
    rule: (e) => {
      if (!isWrite(e)) return NA;
      // A POST lookup changes nothing; a route no client calls has no product rule to check.
      if (e.definition.destructive === false && !STORES_ANYWAY[e.id]) return NA;
      if (NO_CLIENT[e.id]) return NA;
      if (e.businessRules.length || mentioned('business-rules', e) || mentioned('e2e', e))
        return { applies: true, covered: true };
      const walled =
        walledReason(e) ??
        (e.sideEffect === 'external'
          ? `${WALLED}: an outside paid service per request (sideEffect 'external', always blocked)`
          : undefined);
      if (walled) return { applies: true, covered: false, gap: walled };
      return { applies: true, covered: false, gap: 'no rule or lifecycle drives it' };
    },
  },
};

test.describe('KPost API coverage by test type @framework', () => {
  test('writes docs/generated/kpost-api-type-coverage.md', () => {
    const endpoints = inScope();
    expect(endpoints.length, 'KPost API endpoints in scope').toBeGreaterThan(200);
    const order: CheckType[] = [
      'contract',
      'positive',
      ...CHECK_TYPES.filter((t) => t !== 'contract' && t !== 'positive'),
    ];
    const rows: string[] = [];
    const sections: string[] = [];
    const walledWhy = new Map<string, string>();
    for (const type of order) {
      const all = endpoints.map((e) => ({ e, v: RULES[type].rule(e) })).filter((x) => x.v.applies);
      // Walled by owner rule (a real SMS/e-mail, a session ender): never to be run, so not a gap.
      const walled = all.filter((x) => !x.v.covered && x.v.gap?.includes(WALLED));
      const verdicts = all.filter((x) => !walled.includes(x));
      const covered = verdicts.filter((x) => x.v.covered).length;
      const pct = verdicts.length ? Math.round((1000 * covered) / verdicts.length) / 10 : 100;
      rows.push(
        `| ${type} | ${RULES[type].means} | ${verdicts.length} | ${covered} | ${verdicts.length - covered} | ${walled.length} | **${pct}%** |`,
      );
      for (const x of walled)
        walledWhy.set(x.e.id, (x.v.gap ?? '').slice((x.v.gap ?? '').indexOf(WALLED)));
      const gaps = verdicts.filter((x) => !x.v.covered);
      const byReason = new Map<string, string[]>();
      for (const { e, v } of gaps) {
        const reason = (v.gap ?? '').replace(/ for .*$|takes .*;/, (m) =>
          m.startsWith(' for') ? ' for some fields' : 'takes an id;',
        );
        byReason.set(reason, [
          ...(byReason.get(reason) ?? []),
          `\`${e.id}\`${v.gap && v.gap !== reason ? ` — ${v.gap}` : ''}`,
        ]);
      }
      const publicNote =
        type === 'authorization'
          ? `**Not counted: files every signed-in user may read by design** (${Object.keys(PUBLIC_FILES).length}; their login check is the authentication type's)\n\n` +
            Object.entries(PUBLIC_FILES)
              .map(([id, why]) => `- \`${id}\` — ${why}`)
              .join('\n') +
            '\n\n**Input keys that end in "id" but name no one\'s record** (an endpoint whose only ids are these is not counted)\n\n' +
            Object.entries(NOT_A_RECORD)
              .map(([key, why]) => `- \`${key}\` — ${why}`)
              .join('\n') +
            '\n\n'
          : '';
      const boundaryNote =
        type === 'boundary'
          ? `**Not counted: every input has a cited "no limit"** (${UNBOUNDED.size}; only compared, a flag, or never read — reasons in \`src/api/contract/source/kpost-api.limits.json\`)\n\n` +
            [...UNBOUNDED]
              .sort()
              .map((id) => `- \`${id}\``)
              .join('\n') +
            `\n\n**Limited inputs the QA guard keeps edge values out of** (${GUARDED_EDGES.size}; mobile numbers, e-mails, company names, numeric record ids)\n\n` +
            [...GUARDED_EDGES]
              .sort()
              .map((x) => `- \`${x.replace(' ', '` ')}`)
              .join('\n') +
            '\n\n'
          : '';
      const integrityNote =
        type === 'data-integrity'
          ? `**Not counted: writes that store nothing in the database** (${Object.keys(NO_DB_WRITE).length})\n\n` +
            Object.entries(NO_DB_WRITE)
              .map(([id, why]) => `- \`${id}\` — ${why}`)
              .join('\n') +
            '\n\n**Counted although declared a read: they store a row**\n\n' +
            Object.entries(STORES_ANYWAY)
              .map(([id, why]) => `- \`${id}\` — ${why}`)
              .join('\n') +
            '\n\n'
          : '';
      const rulesNote =
        type === 'business-rules'
          ? `**Not counted: writes no client calls (no screen, no product rule)** (${Object.keys(NO_CLIENT).length})\n\n` +
            Object.entries(NO_CLIENT)
              .map(([id, why]) => `- \`${id}\` — ${why}`)
              .join('\n') +
            '\n\n'
          : '';
      sections.push(
        `## ${type} — ${pct}% (${covered}/${verdicts.length})\n\n${RULES[type].means}.\n\n` +
          publicNote +
          boundaryNote +
          integrityNote +
          rulesNote +
          (gaps.length
            ? [...byReason.entries()]
                .sort((a, b) => b[1].length - a[1].length)
                .map(
                  ([reason, list]) =>
                    `**${reason}** (${list.length})\n\n${list.map((l) => `- ${l}`).join('\n')}`,
                )
                .join('\n\n')
            : 'No gap.'),
      );
    }
    const md = [
      '# KPost API — coverage by test type',
      '',
      '**GENERATED — do not edit.** Written by `tests/framework/ledgers/test-types-ledger.spec.ts` (`npm run framework`).',
      `${endpoints.length} KPost API endpoints in scope (KDoc/KOS excluded). Static: what the bench is able to check on`,
      'the QA server; whether each check passes is the run report.',
      '',
      '| Type | Covered means | Applies to | Covered | Gap | Walled by rule | Coverage |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
      ...rows,
      '',
      '"Walled by rule": endpoints the owner rules forbid on a shared QA server, or that no QA account can',
      'ever make succeed (unreachable by design), so they are not counted as gaps. The SMS senders and',
      'session enders are refused by the production guard (`tests/framework/safety/walled-endpoints.spec.ts`);',
      'the others are listed with why.',
      '',
      ...[...walledWhy.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, why]) => `- \`${id}\` — ${why.replace(`${WALLED}: `, '')}`),
      '',
      ...sections.map((s) => `${s}\n`),
    ].join('\n');
    fs.writeFileSync(OUT, md, 'utf8');
    // The data-integrity worklist: every write with no database check yet, with what it declares.
    if (process.env.DATA_INTEGRITY_WORKLIST)
      fs.writeFileSync(
        process.env.DATA_INTEGRITY_WORKLIST,
        JSON.stringify(
          endpoints
            .filter((e) => {
              const v = RULES['data-integrity'].rule(e);
              return v.applies && !v.covered;
            })
            .map((e) => ({
              id: e.id,
              method: e.method,
              path: e.path,
              destructive: e.definition.destructive,
              sideEffect: e.sideEffect,
              productionSafe: e.definition.productionSafe,
              tags: e.tags,
              summary: e.definition.summary,
              gap: RULES['data-integrity'].rule(e).gap,
              flows: FLOW_TYPES.filter((t) => mentioned(t, e)),
            })),
          null,
          1,
        ),
        'utf8',
      );
    // The full boundary worklist (every field with no limit yet, by endpoint), for deriving limits.
    if (process.env.BOUNDARY_WORKLIST)
      fs.writeFileSync(
        process.env.BOUNDARY_WORKLIST,
        JSON.stringify(
          Object.fromEntries(
            endpoints
              .map(
                (e) =>
                  [
                    e.id,
                    {
                      method: e.method,
                      path: e.path,
                      sideEffect: e.sideEffect,
                      open: inputs(e)
                        .filter((f) => /string|integer|number/.test(f.type) && !f.limited)
                        .map((f) => `${f.path} (${f.type})`),
                    },
                  ] as const,
              )
              .filter(([, v]) => v.open.length),
          ),
          null,
          1,
        ),
        'utf8',
      );
  });
});
