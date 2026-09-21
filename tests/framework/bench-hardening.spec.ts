import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { apiRegistry } from '@api/definitions/index';
import { defineAdminEndpoint } from '@api/definitions/admin/admin-endpoint';
import { defineKmailEndpoint } from '@api/definitions/kmail/kmail-endpoint';
import { defineKpostEndpoint } from '@api/definitions/kpost/kpost-endpoint';
import { ROOT_DIR } from '@config/constants';
import { runProbes } from '@engine/probe';
import { ProductionSafetyError } from '@engine/production-guard';
import type { ValidationContext } from '@engine/validation-context';
import { ENV_SCHEMA_KEYS, env, resolveDryRun } from '@config/env';
import { TEST_DATA_ENV_VARS, testData } from '@config/test-data.config';
import { plannedCases } from '@engine/endpoint-cases';
import { targetsRealHost } from '@engine/endpoint-executor';
import { foreignIdentifiers } from '@engine/qa-identifier-guard';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';

/**
 * Guards for the Phase 1 hardening of the bench itself (docs/PRODUCTION-READINESS-AUDIT.md §3.6).
 * Each pins a defect that was found in the audit, so it cannot quietly come back.
 */

test.describe('bench hardening @framework', () => {
  test('filing is armed only by the command, never by a .env file', () => {
    // A `false` that only a file supplied is overruled → dry run, and flagged so the run says so.
    expect(resolveDryRun(false, undefined)).toEqual({ dryRun: true, forced: true });
    // The command itself (`cross-env BUGZILLA_DRY_RUN=false`, CI) arms filing.
    expect(resolveDryRun(false, 'false')).toEqual({ dryRun: false, forced: false });
    expect(resolveDryRun(true, undefined)).toEqual({ dryRun: true, forced: false });
    expect(resolveDryRun(true, 'true')).toEqual({ dryRun: true, forced: false });
  });

  test('a validator outside the active profile is reported as skipped, not dropped', () => {
    const endpoint = resolveEndpoint(apiRegistry.get('common-languages'));
    const regression = plannedCases(endpoint, 'REGRESSION');
    const injection = regression.find((c) => c.name === 'security.injection');
    expect(injection, 'injection must still be planned under REGRESSION').toBeDefined();
    expect(injection?.skipReason).toContain('not in validation profile REGRESSION');

    const full = plannedCases(endpoint, 'FULL');
    expect(full.find((c) => c.name === 'security.injection')?.skipReason).toBeUndefined();
    // Same case list in every profile — only which cases execute differs.
    expect(full.map((c) => c.name)).toEqual(regression.map((c) => c.name));
  });

  test('every API run command states its validation profile explicitly', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const implicit = Object.entries(pkg.scripts)
      .filter(([, command]) => command.includes('--project=api'))
      .filter(([, command]) => !/VALIDATION_PROFILE=\w+/.test(command))
      .map(([name]) => name);
    expect(implicit, 'API commands relying on the default profile').toEqual([]);
  });

  test('multi-suite commands never chain suites with && (a finding would stop the chain)', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    // `check` chains typecheck && lint on purpose (fail fast). What must not chain is test SUITES:
    // a suite with findings exits non-zero, so everything after it would silently never run.
    const runsSuite = (script: string): boolean =>
      (pkg.scripts[script] ?? '').includes('playwright test');
    const chained = Object.entries(pkg.scripts)
      .filter(([, command]) => command.includes('&&'))
      .filter(([, command]) =>
        [...command.matchAll(/npm run (\S+)/g)].some((match) => runsSuite(match[1] ?? '')),
      )
      .map(([name]) => name);
    expect(chained).toEqual([]);
    expect(pkg.scripts.all).toContain('scripts/run-suites.cjs');
  });

  test('every suite factory honours the requestSchema override', () => {
    const schema = z.object({ onlyField: z.string() });
    const kpost = defineKpostEndpoint({
      id: 'hardening-kpost',
      method: 'POST',
      path: '/v2/common/languages',
      summary: 'guard',
      requestSchema: schema,
    });
    const kmail = defineKmailEndpoint({
      id: 'hardening-kmail',
      method: 'POST',
      path: '/draft/draftMail/',
      summary: 'guard',
      requestSchema: schema,
    });
    const admin = defineAdminEndpoint({
      id: 'hardening-admin',
      method: 'POST',
      path: '/employeeDetails/getEmployeeDetails',
      summary: 'guard',
      requestSchema: schema,
    });
    expect(kpost.requestSchema).toBe(schema);
    expect(kmail.requestSchema, 'KMail used to ignore the override').toBe(schema);
    expect(admin.requestSchema).toBe(schema);
    // KMail keeps its split: the request goes to the prefixed path, the contract path stays bare.
    expect(kmail.path).toBe(`${env.KMAIL_PATH_PREFIX}/draft/draftMail/`);
    expect(kmail.contractPath).toBe('/draft/draftMail/');
  });

  test('the QA-identifier guard inspects multipart fields and JSON raw bodies', () => {
    const stranger = 'stranger.not.ours@kpostindia.com';
    const ours = testData.kpostIdAbsent; // always allowlisted: matches nobody by construction

    // JSON carried inside a multipart `text` field — the company-logo upload's shape.
    const inText = foreignIdentifiers({
      multipart: { text: JSON.stringify({ kpostID: stranger }) },
    });
    expect(inText.map((o) => o.path)).toEqual(['multipart.text.kpostID']);
    // A plain multipart field is judged by its own key.
    expect(foreignIdentifiers({ multipart: { kpostID: stranger } })).toHaveLength(1);
    expect(foreignIdentifiers({ multipart: { kpostID: ours } })).toEqual([]);
    // A file part is bytes, not identifiers.
    const file = { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('x') };
    expect(foreignIdentifiers({ multipart: { file } })).toEqual([]);

    expect(foreignIdentifiers({ rawBody: JSON.stringify({ contactID: stranger }) })).toHaveLength(
      1,
    );
    // Non-JSON raw bodies (the malformed-JSON probe) carry no key to judge by.
    expect(foreignIdentifiers({ rawBody: '{"kpostID": broken' })).toEqual([]);
  });

  test('the QA-identifier guard never applies to the bench’s own mock fixtures', () => {
    const fixtures = apiRegistry.all().filter((api) => api.mockFixture);
    expect(fixtures.length, 'mock fixture endpoints exist').toBeGreaterThan(0);
    const guarded = fixtures.filter((api) => targetsRealHost(resolveEndpoint(api)));
    expect(guarded.map((api) => api.id)).toEqual([]);
  });

  test('.env.example documents every variable the bench reads', () => {
    const example = readFileSync(path.join(ROOT_DIR, '.env.example'), 'utf8');
    const documented = new Set(
      [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]),
    );
    const missing = [...ENV_SCHEMA_KEYS, ...TEST_DATA_ENV_VARS].filter(
      (key) => !documented.has(key),
    );
    expect(missing, 'variables read by the bench but absent from .env.example').toEqual([]);
  });
});

test.describe('a refused probe is inconclusive, never a finding @framework', () => {
  /*
   * The mutating validators rewrite every field, id fields included: `request.data-type` turns
   * `companyId: "242"` into a number, `security.injection` into a SQL tautology. Those name a
   * company we do not own, so the QA-identifier guard refuses to send them — correctly.
   *
   * That refusal used to propagate out of `runProbes` as `validator error: …`, and the validator was
   * reported FAILED. On the Admin suite that was three CRITICAL/HIGH "findings" per endpoint,
   * manufactured entirely from the bench's own safety control. The guard is unchanged; what changed
   * is that its refusal is now recorded as SKIPPED with the reason, exactly as a throttled probe is.
   */
  const probeContext = (send: () => Promise<never>): ValidationContext =>
    ({ send }) as unknown as ValidationContext;

  test('a safety refusal is SKIPPED with the reason, and nothing is reported as failed', async () => {
    const outcome = await runProbes(
      probeContext(() => {
        throw new ProductionSafetyError('refusing to send a request … names 1 identifier(s)');
      }),
      'request.data-type',
      [{ name: 'body.companyId: number instead of string', spec: { body: { companyId: 1 } } }],
      'negative request cases',
    );

    expect(outcome.status, 'a refusal is not evidence of an application defect').toBe('SKIPPED');
    expect(outcome.details?.[0]?.status).toBe('SKIPPED');
    expect(outcome.details?.[0]?.message, 'the reason travels with the skip').toContain(
      'refused by a bench safety control',
    );
    expect(
      outcome.details?.[0]?.request,
      'nothing was sent, so there is no request to reproduce',
    ).toBeUndefined();
  });

  test('a transport error is still judged — only the safety refusal is caught', async () => {
    // Catching every error here would hide a real observation about the host behind a skip.
    const boom = new Error('socket hang up');
    await expect(
      runProbes(
        probeContext(() => {
          throw boom;
        }),
        'request.data-type',
        [{ name: 'case', spec: { body: { companyId: 1 } } }],
        'negative request cases',
      ),
    ).rejects.toThrow('socket hang up');
  });
});
