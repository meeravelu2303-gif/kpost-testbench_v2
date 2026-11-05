import fs from 'node:fs';
import path from 'node:path';
import { apiRegistry } from '@api/definitions/index';
import { toJsonSchema, type ContractSchema } from '@api/schema/contract-schema';
import { ROOT_DIR } from '@config/constants';
import { DEFAULT_SUITE } from '@config/ownership.config';
import { CHECK_TYPES, type CheckType } from '@engine/check-types';
import { destructiveBlockReason, type SafetyFlags } from '@engine/production-guard';
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
        ? fs
            .readdirSync(d, { withFileTypes: true })
            .flatMap((x) =>
              x.isDirectory()
                ? read(path.join(d, x.name))
                : x.name.endsWith('.spec.ts') && !x.name.includes('-endpoints-')
                  ? [fs.readFileSync(path.join(d, x.name), 'utf8')]
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
const onRealRecord = (e: ResolvedEndpoint): boolean =>
  new RegExp(`['"\`]${e.id}['"\`]`).test(REAL_RECORD_SPECS);

/** Why the engine's checks cannot reach this endpoint: guard-blocked and no real-record run. */
const engineBlocked = (e: ResolvedEndpoint): string | undefined =>
  onRealRecord(e) ? undefined : blocked(e);

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
      const walled = walledReason(e);
      if (walled) return { applies: true, covered: false, gap: walled };
      if (!inputs(e).length)
        return { applies: true, covered: false, gap: 'no request schema to mutate' };
      // A fuzzed value in a key the QA-identifier guard protects is never sent (it could name a real
      // record), so an endpoint whose every input is such a key gets no negative probe at all.
      // ...unless the fuzzer's own wrong-type value is one no record can have (cannotBeARecord).
      const fuzzable = inputs(e).filter((f) => {
        const key = f.path.split('.').pop()?.replace('[]', '') ?? '';
        const junk = /integer|number/.test(f.type) ? 'not-a-number' : 12345;
        return !isGuardedIdentifierKey(key) || cannotBeARecord(key, junk);
      });
      if (!fuzzable.length)
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
      const open = scalar.filter((f) => !f.limited).map((f) => f.path);
      if (open.length)
        return {
          applies: true,
          covered: false,
          gap: `no limit for ${open.slice(0, 6).join(', ')}${open.length > 6 ? ` +${open.length - 6}` : ''}`,
        };
      const why = engineBlocked(e);
      return why ? { applies: true, covered: false, gap: why } : { applies: true, covered: true };
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
      const ids = inputs(e).filter((f) => /(^|\.)\w*(id|ids|uuid|kpostid)(\[\])?$/i.test(f.path));
      if (!e.authentication.required || !ids.length) return NA;
      if (mentioned('authorization', e) || e.authorization.tenantScoped)
        return { applies: true, covered: true };
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
      if (e.databaseValidations.length || mentioned('data-integrity', e))
        return { applies: true, covered: true };
      return { applies: true, covered: false, gap: 'no database check of what it stored' };
    },
  },
  'business-rules': {
    means: 'a write has its product rule checked by the end result (a rule spec or a lifecycle)',
    rule: (e) => {
      if (!isWrite(e)) return NA;
      if (e.businessRules.length || mentioned('business-rules', e) || mentioned('e2e', e))
        return { applies: true, covered: true };
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
      sections.push(
        `## ${type} — ${pct}% (${covered}/${verdicts.length})\n\n${RULES[type].means}.\n\n` +
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
  });
});
