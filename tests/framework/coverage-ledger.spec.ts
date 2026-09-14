// Generates docs/COVERAGE.md, so the "conditionals" flagged here are string/table formatting.
/* eslint-disable playwright/no-conditional-in-test */
import fs from 'node:fs';
import path from 'node:path';
import { apiRegistry } from '@api/definitions/index';
import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import { contractPaths } from '@api/contract/workbook-contract';
import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';

/**
 * THE coverage ledger — one generated file (`docs/COVERAGE.md`) that accounts for **every** endpoint
 * the workbook documents and **every** screen the app has, with a status for each. It is the answer
 * to "did we miss anything": nothing can be silently uncovered, because every documented path lands
 * in exactly one bucket and every module carries an explicit scope decision.
 *
 * Generated from the registry + the generated contracts, never hand-kept — a hand-written coverage
 * list of 337 endpoints is wrong within a day and then lies. Run `npm run test:framework`.
 */

/** KMail spreads across many URL prefixes; it is one module (its own suite, host and owner). */
const KMAIL_PREFIXES = new Set([
  'kmail5',
  'sentmail',
  'readmail',
  'draft',
  'kmaildata',
  'kmailsetting',
]);

/** The module a documented path belongs to. The kmail-api suite and every KMail prefix fold to one. */
function moduleKey(suite: string, p: string): string {
  if (suite === 'kmail-api') return 'kmail';
  const m = p.match(/^\/(?:v2\/)?([a-zA-Z0-9]+)\//);
  const mod = m?.[1]?.toLowerCase() ?? 'other';
  return KMAIL_PREFIXES.has(mod) ? 'kmail' : mod;
}

/**
 * Every module's scope decision. `built` modules are under test today; the rest carry the reason
 * they are not, so a gap is a recorded decision rather than an oversight. A module prefix that
 * appears in the contract but not here fails the assertion below — nothing stays unclassified.
 */
type Scope =
  | { status: 'built'; note: string }
  | { status: 'backlog'; note: string }
  | { status: 'needs-business'; note: string }
  | { status: 'external'; note: string }
  | { status: 'out-of-scope'; note: string };

const MODULE_SCOPE: Record<string, Scope> = {
  common: { status: 'built', note: 'reference data, identity, company, OTP (OTP writes gated)' },
  signuplogin: { status: 'built', note: 'login & session; signup out of scope (OTP-gated)' },
  signuploginformediumandlarge: { status: 'needs-business', note: 'business-tier admin login' },
  katchup: { status: 'built', note: 'messaging — full API + write lifecycle + screen' },
  group: { status: 'built', note: 'group membership (FR-K06)' },
  profile: { status: 'built', note: 'profile — full API + write lifecycle + screens' },
  dashboard: { status: 'built', note: 'home recent-messages panel' },
  kall: { status: 'built', note: 'calling — full API + write lifecycle + screen' },
  contacts: { status: 'built', note: 'address book — reads live, writes gated lifecycle' },
  dairyschedule: {
    status: 'built',
    note: 'KDiary — schedules/events/reports; reads live, writes gated',
  },
  generalsetting: {
    status: 'built',
    note: 'Settings — theme/font/notifications; reads live, writes gated',
  },
  kmailsetting: { status: 'backlog', note: 'KMail settings (signature, instant reply)' },
  kword: {
    status: 'built',
    note: 'KOS/KWord — document CRUD; reads live, writes gated (API-only)',
  },
  ai: { status: 'built', note: 'KOS K-AI — sessions read live; generation metered/external' },
  aws: {
    status: 'built',
    note: 'S3 presigned URLs + attachment check/delete; generators run live',
  },
  kmail: {
    status: 'built',
    note: 'KMail — reads live, compose/draft/settings write lifecycle (host kmail5, /kmail5/v2)',
  },
  translator: { status: 'backlog', note: 'translation (shared Katchup/KMail)' },
  admin: { status: 'needs-business', note: 'org/HR admin — needs a business company with members' },
  redbus: { status: 'out-of-scope', note: 'third-party travel booking; confirm scope with owner' },
  ecommerce: { status: 'out-of-scope', note: 'third-party commerce; confirm scope with owner' },
  metadee: { status: 'out-of-scope', note: 'third-party; confirm scope with owner' },
  knews: { status: 'external', note: 'external RSS feeds, not the KPost API' },
  kpresentation: { status: 'out-of-scope', note: 'KDOC — out of scope per BRD §4.2' },
  other: { status: 'backlog', note: 'unprefixed paths — review individually' },
};

/** Routes from MenuRoutes.js → the e2e spec that covers the screen (or none yet). */
const SCREENS: Array<{ route: string; spec: string | null; note: string }> = [
  { route: '/login', spec: 'login.spec.ts', note: 'two-step login' },
  { route: '/home', spec: 'home.spec.ts', note: 'landing + recent panel' },
  { route: '(shell)', spec: 'shell.spec.ts', note: 'header + nav rail (all screens)' },
  { route: '/katchup', spec: 'katchup.spec.ts', note: 'messaging' },
  { route: '/kall', spec: 'kall.spec.ts', note: 'calling' },
  { route: '/kmail', spec: 'kmail.spec.ts', note: 'email' },
  { route: '/userprofile', spec: 'profile.spec.ts', note: 'profile + settings' },
  { route: '/settings', spec: 'settings.spec.ts', note: 'settings workspace' },
  { route: '/kdirectory', spec: null, note: 'out of scope per BRD §4.2' },
  { route: '/kcloud', spec: 'auxiliary.spec.ts', note: 'smoke (no API)' },
  { route: '/kbooking', spec: 'auxiliary.spec.ts', note: 'smoke (no API)' },
  { route: '/knews', spec: 'auxiliary.spec.ts', note: 'smoke (external RSS)' },
  { route: '/e-commerce', spec: 'auxiliary.spec.ts', note: 'smoke (third-party)' },
  { route: '/kdoc', spec: null, note: 'KOS "Coming Soon" today' },
  { route: '/usermanagement', spec: null, note: 'admin — needs a business account' },
];

test.describe('coverage ledger @framework', () => {
  test('write docs/COVERAGE.md accounting for every endpoint and screen', () => {
    const registered = new Set(
      apiRegistry
        .all()
        .filter((d: EndpointDefinition) => !d.mockFixture)
        .flatMap((d: EndpointDefinition) => [d.path, ...(d.contractPath ? [d.contractPath] : [])]),
    );
    const runsLive = new Set(
      apiRegistry
        .all()
        .filter((d: EndpointDefinition) => d.productionSafe && !d.mockFixture)
        // include contractPath too — KMail's request path is prefixed (/kmail5/v2), while the
        // documented path (what we bucket by) is the unprefixed contractPath.
        .flatMap((d: EndpointDefinition) => [d.path, ...(d.contractPath ? [d.contractPath] : [])]),
    );

    const documented = [
      ...contractPaths('kpost-api').map((p) => ({ suite: 'kpost-api', path: p })),
      ...contractPaths('kmail-api').map((p) => ({ suite: 'kmail-api', path: p })),
    ];

    /*
     * The workbook documents some endpoints under two path spellings — a legacy `/kmail5/…` or a
     * bare `/kmailSetting/…` alongside the `/v2/…` form we register under. They are the SAME
     * endpoint, so a literal string compare reports the second spelling as "uncovered" when it is
     * fully tested. Canonicalise both sides — drop a leading `/kmail5` and `/v2` and a trailing
     * slash — so a covered endpoint matches whichever spelling the ledger walks.
     */
    const canon = (p: string): string =>
      p
        .replace(/^\/kmail5(?=\/)/, '')
        .replace(/^\/v2(?=\/)/, '')
        .replace(/\/+$/, '');
    const registeredCanon = new Set([...registered].map(canon));
    const runsLiveCanon = new Set([...runsLive].map(canon));

    // Bucket every documented path by module.
    const modules = new Map<
      string,
      { total: number; registered: number; live: number; uncovered: string[] }
    >();
    const unclassified = new Set<string>();
    for (const { suite, path: p } of documented) {
      const mod = moduleKey(suite, p);
      if (!MODULE_SCOPE[mod]) unclassified.add(mod);
      const bucket = modules.get(mod) ?? { total: 0, registered: 0, live: 0, uncovered: [] };
      bucket.total += 1;
      if (registered.has(p) || registeredCanon.has(canon(p))) {
        bucket.registered += 1;
        if (runsLive.has(p) || runsLiveCanon.has(canon(p))) bucket.live += 1;
      } else {
        bucket.uncovered.push(p);
      }
      modules.set(mod, bucket);
    }

    const order: Record<Scope['status'], number> = {
      built: 0,
      backlog: 1,
      'needs-business': 2,
      external: 3,
      'out-of-scope': 4,
    };
    const rows = [...modules.entries()].sort(
      (a, b) =>
        order[MODULE_SCOPE[a[0]]?.status ?? 'backlog'] -
          order[MODULE_SCOPE[b[0]]?.status ?? 'backlog'] || b[1].total - a[1].total,
    );

    const totalDoc = documented.length;
    const totalReg = rows.reduce((n, [, b]) => n + b.registered, 0);
    const totalLive = rows.reduce((n, [, b]) => n + b.live, 0);
    const builtDoc = rows
      .filter(([m]) => MODULE_SCOPE[m]?.status === 'built')
      .reduce((n, [, b]) => n + b.total, 0);

    const screensCovered = SCREENS.filter((s) => s.spec).length;

    const lines: string[] = [
      '# Coverage ledger — every endpoint, every screen',
      '',
      '**GENERATED — do not edit.** Written by `tests/framework/coverage-ledger.spec.ts`',
      '(`npm run test:framework`). It reconciles the registry against the generated contracts, so it',
      'cannot drift from what is actually tested.',
      '',
      '## API — endpoints',
      '',
      '| | Count |',
      '| - | ----: |',
      `| Documented (workbook, usable) | ${totalDoc} |`,
      `| **Registered & tested** | **${totalReg}** |`,
      `| — of those, run on live | ${totalLive} |`,
      `| In "built" modules | ${builtDoc} |`,
      '',
      '| Module | Documented | Tested | Live | Status | Note |',
      '| ------ | ---------: | -----: | ---: | ------ | ---- |',
      ...rows.map(([mod, b]) => {
        const scope = MODULE_SCOPE[mod] ?? { status: 'backlog', note: '—' };
        return `| \`${mod}\` | ${b.total} | ${b.registered} | ${b.live} | ${scope.status} | ${scope.note} |`;
      }),
      '',
      '### Uncovered documented paths (the backlog, module by module)',
      '',
      ...rows
        .filter(([, b]) => b.uncovered.length)
        .flatMap(([mod, b]) => [
          `**\`${mod}\`** (${b.uncovered.length}) — ${MODULE_SCOPE[mod]?.status}`,
          '',
          ...b.uncovered.map((p) => `- \`${p}\``),
          '',
        ]),
      '## Screens',
      '',
      `Covered: **${screensCovered} / ${SCREENS.length}** routes.`,
      '',
      '| Route | e2e spec | Note |',
      '| ----- | -------- | ---- |',
      ...SCREENS.map((s) => `| \`${s.route}\` | ${s.spec ? `\`${s.spec}\`` : '—'} | ${s.note} |`),
      '',
      '## What "complete" is blocked on',
      '',
      '- **OTP-gated endpoints never run on live** (no bypass — a security property). `npm run contract:otp`.',
      '- **`needs-business` modules** (admin, business-tier login) need a business company with members.',
      '- **`external`/`out-of-scope`** modules (KNews RSS, RedBus/ECommerce/MetaDee, KDOC) await an owner',
      '  scope decision or are excluded per the BRD.',
      '',
    ];

    const outPath = path.join(ROOT_DIR, 'docs', 'COVERAGE.md');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${lines.join('\n')}\n`);

    // Nothing stays unclassified: a new module prefix must be given a scope decision here.
    expect([...unclassified], 'add these module prefixes to MODULE_SCOPE with a scope').toEqual([]);
    // No phantom coverage: every registered non-fixture endpoint's documented path (its
    // `contractPath` when the live path was corrected, else its path) is in a contract.
    const documentedPaths = new Set(documented.map((d) => d.path));
    const phantom = apiRegistry
      .all()
      .filter((d: EndpointDefinition) => !d.mockFixture)
      .map((d: EndpointDefinition) => d.contractPath ?? d.path)
      .filter((p: string) => !documentedPaths.has(p) && !p.includes('{'));
    expect(phantom, 'registered endpoints whose documented path is in no contract').toEqual([]);
    expect(totalReg, 'the built modules cover a substantial share').toBeGreaterThan(140);
  });
});
