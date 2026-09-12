import { apiRegistry } from '@api/definitions/index';
import { ApiRegistry } from '@api/registry/api-registry';
import { readBugzillaConfig } from '@config/bugzilla.config';
import { env } from '@config/env';
import { SUITES, componentFor, suiteFor, type SuiteId } from '@config/ownership.config';
import { resolveEndpoint } from '@engine/validation-policy';
import { expect, test } from '@fixtures';
import { candidateFromUiFailure, candidatesFromReport } from '../../src/bug-tracker/bug-candidate';
import type { ValidationReport } from '../../src/validation-engine/validation-result';

/**
 * Defect ownership is the one thing that must never be wrong: a ticket that reaches the wrong
 * developer is worse than no ticket. These pin the routing table and check it still agrees with
 * the live Bugzilla configuration.
 */

function reportWith(suite: SuiteId, tags: string[]): ValidationReport {
  return {
    endpointId: 'example',
    endpoint: 'GET /example',
    method: 'GET',
    tags,
    suite,
    profile: 'REGRESSION',
    environment: 'dev',
    build: 'local',
    testRunId: 'run-1',
    correlationId: 'tb-1',
    startedAt: '2026-09-12T10:00:00.000Z',
    durationMs: 10,
    results: [
      {
        validationId: 'v1',
        validatorName: 'response.status-code',
        category: 'RESPONSE',
        endpointId: 'example',
        endpoint: 'GET /example',
        method: 'GET',
        expected: [200],
        actual: 500,
        status: 'FAILED',
        message: 'expected 200, got 500',
        durationMs: 1,
        timestamp: '2026-09-12T10:00:00.000Z',
        severity: 'CRITICAL',
        correlationId: 'tb-1',
      },
    ],
    summary: { total: 1, passed: 0, failed: 1, warnings: 0, skipped: 0 },
    gate: { passed: false, blocking: ['response.status-code'] },
  };
}

test.describe('Defect ownership', { tag: '@framework' }, () => {
  test('each module routes to its own product and developer', () => {
    expect(SUITES['kpost-api'].bugzilla.product).toBe('KPost API');
    expect(SUITES['kpost-api'].owner.email).toBe('jagan@kpost.in');
    expect(SUITES['admin-api'].bugzilla.product).toBe('KPost Admin');
    expect(SUITES['admin-api'].owner.email).toBe('jagan@kpost.in');
    expect(SUITES['kmail-api'].bugzilla.product).toBe('KMail API');
    expect(SUITES['kmail-api'].owner.email).toBe('jitendra@kpost.in');
    expect(SUITES['kpost-ui'].bugzilla.product).toBe('KPost UI');
    expect(SUITES['kpost-ui'].owner.email).toBe('ayyappan@kpostindia.com');
  });

  test('a defect carries its module all the way to the ticket', () => {
    const config = readBugzillaConfig();

    const kmail = candidatesFromReport(
      reportWith('kmail-api', ['Draft Mail']),
      { baseURL: 'http://kmail' },
      config,
    )[0];
    expect(kmail).toMatchObject({
      product: 'KMail API',
      component: 'Draft Mail',
      assignee: 'jitendra@kpost.in',
      version: '5.0',
    });

    const admin = candidatesFromReport(
      reportWith('admin-api', ['Departments']),
      { baseURL: 'http://admin' },
      config,
    )[0];
    expect(admin).toMatchObject({
      product: 'KPost Admin',
      component: 'Departments',
      assignee: 'jagan@kpost.in',
    });

    const core = candidatesFromReport(
      reportWith('kpost-api', ['Authentication V2']),
      { baseURL: 'http://api' },
      config,
    )[0];
    expect(core).toMatchObject({
      product: 'KPost API',
      component: 'Authentication V2',
      assignee: 'jagan@kpost.in',
    });

    const ui = candidateFromUiFailure(
      {
        file: 'tests/e2e/writemail/compose.spec.ts',
        title: 'sends a mail',
        message: 'expected button to be enabled',
        fullMessage: 'expected button to be enabled',
        browser: 'chromium',
        environment: 'dev',
        baseURL: 'http://ui',
        build: 'local',
        testRunId: 'run-1',
        observedAt: '2026-09-12T10:00:00.000Z',
      },
      config,
    );
    expect(ui).toMatchObject({
      product: 'KPost UI',
      component: 'WriteMail',
      assignee: 'ayyappan@kpostindia.com',
    });
  });

  test('an unmapped area falls back to the module catch-all, never to another module', () => {
    expect(componentFor(suiteFor('kmail-api'), ['Nonexistent Tag'])).toBe('kmail-application');
    expect(componentFor(suiteFor('admin-api'), [])).toBe('admin-module-application');
    expect(componentFor(suiteFor('kpost-api'), ['Katchup Messaging V1 (superseded)'])).toBe(
      'kpost-webservice-application',
    );
    expect(componentFor(suiteFor('kpost-ui'), ['unknown-screen'])).toBe('General');
  });

  test('two modules may share a path — they are separate services', () => {
    const registry = new ApiRegistry();

    // Every Spring Boot service answers GET /health; that is not a collision.
    expect(() =>
      registry.register(
        { id: 'kpost-health', method: 'GET', path: '/health', suite: 'kpost-api' },
        { id: 'kmail-health', method: 'GET', path: '/health', suite: 'kmail-api' },
        { id: 'admin-health', method: 'GET', path: '/health', suite: 'admin-api' },
      ),
    ).not.toThrow();

    // The same path twice within ONE module still is.
    expect(() =>
      registry.register({
        id: 'kmail-health-again',
        method: 'GET',
        path: '/health',
        suite: 'kmail-api',
      }),
    ).toThrow(/already registered in kmail-api/);
  });

  test('every registered endpoint resolves to a real module', () => {
    for (const definition of apiRegistry.all()) {
      const endpoint = resolveEndpoint(definition);
      expect(Object.keys(SUITES), `${endpoint.id} has an unknown suite`).toContain(
        endpoint.suite.id,
      );
      expect(endpoint.suite.baseUrl, `${endpoint.id} has no base URL`).toBeTruthy();
    }
  });

  test.describe('against the live Bugzilla', () => {
    test.skip(
      !env.BUGZILLA_URL || !env.BUGZILLA_API_KEY,
      'needs BUGZILLA_URL and BUGZILLA_API_KEY',
    );

    test('our owners still match the component defaults on the instance', async () => {
      for (const suite of Object.values(SUITES)) {
        const url =
          `${env.BUGZILLA_URL}/product?names=${encodeURIComponent(suite.bugzilla.product)}` +
          `&include_fields=name,components.name,components.default_assigned_to&api_key=${env.BUGZILLA_API_KEY}`;
        const body = (await (await fetch(url)).json()) as {
          products?: { components?: { name: string; default_assigned_to?: string }[] }[];
        };
        const components = body.products?.[0]?.components ?? [];
        expect(components.length, `${suite.bugzilla.product} has no components`).toBeGreaterThan(0);

        const owners = [...new Set(components.map((component) => component.default_assigned_to))];
        expect(
          owners,
          `${suite.bugzilla.product} default assignee drifted from ownership.config.ts`,
        ).toEqual([suite.owner.email]);
      }
    });
  });
});
