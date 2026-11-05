import fs from 'node:fs';
import path from 'node:path';
import { apiRegistry } from '@api/definitions/index';
import { toJsonSchema, type ContractSchema } from '@api/schema/contract-schema';
import { ROOT_DIR } from '@config/constants';
import { DEFAULT_SUITE } from '@config/ownership.config';
import { CHECK_TYPES, type CheckType } from '@engine/check-types';
import { destructiveBlockReason, type SafetyFlags } from '@engine/production-guard';
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

/** Why the engine may not send this endpoint's normal request in a product run, or undefined. */
function blocked(e: ResolvedEndpoint): string | undefined {
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
      const flow = ['e2e', 'business-rules', 'data-integrity', 'positive', 'authentication'].some(
        (t) => mentioned(t, e),
      );
      return flow ? { applies: true, covered: true } : { applies: true, covered: false, gap: why };
    },
  },
  contract: {
    means: 'a documented response schema (workbook, or backend source confirmed live) is checked',
    rule: (e) =>
      !e.responseSchema
        ? {
            applies: true,
            covered: false,
            gap: 'no response schema (workbook silent, source not confirmed live)',
          }
        : blocked(e)
          ? { applies: true, covered: false, gap: `schema known, but ${blocked(e)}` }
          : { applies: true, covered: true },
  },
  negative: {
    means: 'an endpoint that takes input gets bad input sent to it',
    rule: (e) => {
      if (!inputs(e).length && e.method === 'GET') return NA;
      if (!inputs(e).length)
        return { applies: true, covered: false, gap: 'no request schema to mutate' };
      const why = blocked(e);
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
      const why = blocked(e);
      return why ? { applies: true, covered: false, gap: why } : { applies: true, covered: true };
    },
  },
  authentication: {
    means: 'a login-protected endpoint is sent no, forged, expired and malformed tokens',
    rule: (e) => {
      if (!e.authentication.required) return NA;
      const why = blocked(e);
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
      const why = blocked(e);
      return why ? { applies: true, covered: false, gap: why } : { applies: true, covered: true };
    },
  },
  performance: {
    means: 'its response time and size are measured on the QA server',
    rule: (e) => {
      const why = blocked(e);
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
    const byType = new Map<CheckType, string[]>();
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
      if (walled.length)
        byType.set(
          type,
          walled.map((x) => x.e.id),
        );
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
      '"Walled by rule": endpoints that send a real SMS/e-mail or end the running session. The owner rules',
      'forbid running them on a shared QA account, so they are not counted as gaps (proved refused by',
      '`tests/framework/safety/walled-endpoints.spec.ts`):',
      [...new Set([...byType.values()].flat())]
        .sort()
        .map((id) => `\`${id}\``)
        .join(', ') + '.',
      '',
      ...sections.map((s) => `${s}\n`),
    ].join('\n');
    fs.writeFileSync(OUT, md, 'utf8');
  });
});
