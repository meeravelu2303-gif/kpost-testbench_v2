import { z } from 'zod';
import { apiRegistry } from '@api/definitions/index';
import { env } from '@config/env';
import { destructiveBlockReason } from '@engine/production-guard';
import { DEFAULT_POLICY, resolveEndpoint } from '@engine/validation-policy';
import { outcome } from '@engine/validation-result';
import { defineValidator, type Validator } from '@engine/validator';
import { expect, test } from '@fixtures';
import { maskSensitive } from '@utils/masking';
import { validationRegistry } from '@validators/index';

const centralValidatorNames = (validators: Validator[]): string[] =>
  validators
    .map((v) => v.name)
    .filter((name) => !name.startsWith('business-rule.') && !name.startsWith('database.'))
    .sort();

/** Self-tests proving the architecture's guarantees (acceptance scenario of the framework). */
test.describe('Validation framework', { tag: '@framework' }, () => {
  test('POST /users, GET /users/{id} and POST /companies receive the same central validators', ({
    validationEngine,
  }) => {
    const everyValidator = validationRegistry
      .all()
      .map((v) => v.name)
      .sort();

    for (const id of ['create-user', 'get-user', 'create-company']) {
      expect(centralValidatorNames(validationEngine.plan(id, 'FULL')), id).toEqual(everyValidator);
    }
  });

  test('business rules and DB validations stay endpoint-specific', ({ validationEngine }) => {
    const names = (id: string): string[] => validationEngine.plan(id, 'FULL').map((v) => v.name);

    expect(names('create-user')).toEqual(
      expect.arrayContaining([
        'business-rule.company-user-limit',
        'business-rule.duplicate-user',
        'database.user-created',
      ]),
    );
    expect(names('create-company')).toContain('business-rule.duplicate-company-name');
    expect(names('create-company')).not.toContain('business-rule.company-user-limit');
    expect(names('get-user').filter((n) => n.startsWith('business-rule.'))).toEqual([]);
  });

  test('health-check override disables only authentication and authorization', () => {
    const { validations } = resolveEndpoint(apiRegistry.get('health-check'));
    expect(validations).toEqual({ ...DEFAULT_POLICY, authentication: false, authorization: false });
  });

  test('OpenAPI-loaded endpoint gets its contract from the spec', () => {
    const endpoint = resolveEndpoint(apiRegistry.get('list-dictionary-terms'));
    expect(endpoint).toMatchObject({
      method: 'GET',
      path: '/dictionary/terms',
      expectedStatus: [200],
      pagination: true,
    });
    expect(endpoint.authentication.required).toBe(true);
    expect(endpoint.authorization.roles).toHaveLength(4);
    expect(endpoint.querySchema).toBeDefined();
    expect(endpoint.responseSchema).toBeDefined();
  });

  test('production guard blocks destructive endpoints unless explicitly allowed', () => {
    /*
     * Literal endpoints, not registry ones. The registry's destructive endpoints are all
     * `mockFixture: true`, and a fixture is exempt from the live rules by design — it is served by
     * the bundled mock and cannot reach a real API. Using one here tested the exemption rather
     * than the rule it is an exception to.
     *
     * The live-application rules (allowlist, OTP, and ALLOW_DESTRUCTIVE_TESTS granting nothing)
     * are covered in tests/framework/live-safety.spec.ts.
     */
    const offLive = { isProduction: false, allowDestructive: false };

    expect(
      destructiveBlockReason(
        { label: 'POST /x', destructive: true, sideEffect: 'external' },
        offLive,
      ),
      'a real SMS needs the flag on every environment',
    ).toContain('ALLOW_DESTRUCTIVE_TESTS');
    expect(
      destructiveBlockReason(
        { label: 'POST /x', destructive: true, sideEffect: 'external' },
        { ...offLive, allowDestructive: true },
      ),
      'and the flag unlocks it off the live application',
    ).toBeUndefined();
    expect(
      destructiveBlockReason({ label: 'POST /x', destructive: true }, offLive),
      'a test-owned data write needs no flag off the live application',
    ).toBeUndefined();
    expect(
      destructiveBlockReason({ label: 'GET /x', destructive: false }, offLive),
      'a read is never blocked',
    ).toBeUndefined();

    // A mock fixture is exempt even when the run is configured for the live application.
    expect(
      destructiveBlockReason(resolveEndpoint(apiRegistry.get('delete-user')), {
        isProduction: true,
        allowDestructive: false,
      }),
      'the bench’s own fixtures always run: they are served by the mock',
    ).toBeUndefined();
  });

  test('secrets and personal data are masked', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    const masked = maskSensitive({
      password: 'hunter2',
      headers: { authorization: `Bearer ${jwt}` },
      note: `token ${jwt} for jane.doe@kpost.test via postgres://app:s3cret@db:5432/kpost`,
    });
    const serialized = JSON.stringify(masked);
    for (const secret of ['hunter2', jwt, 'jane.doe', 's3cret'])
      expect(serialized).not.toContain(secret);
  });

  test.describe('against the API', () => {
    test.skip(!env.MOCK_API, 'uses mock-only routes');

    test('a newly registered validator runs for every endpoint without editing endpoint tests', async ({
      createValidationEngine,
    }) => {
      const cacheControl = defineValidator({
        name: 'response.cache-control',
        category: 'RESPONSE',
        severity: 'LOW',
        description: 'Cache-Control header is present',
        toggle: 'headers',
        check: ({ primary }) =>
          primary.header('cache-control')
            ? outcome.passed('present')
            : outcome.failed('Cache-Control missing'),
      });
      const engine = createValidationEngine({
        validators: validationRegistry.clone().register(cacheControl),
        onReport: undefined,
      });

      for (const endpoint of apiRegistry.all()) {
        expect(
          engine.plan(endpoint.id, 'SMOKE').map((v) => v.name),
          endpoint.id,
        ).toContain('response.cache-control');
      }
      const report = await engine.validate('get-user', { profile: 'SMOKE' });
      expect(report.results.find((r) => r.validatorName === 'response.cache-control')?.status).toBe(
        'PASSED',
      );
    });

    test('all results are collected; dependents of a failed validator are SKIPPED with a reason', async ({
      createValidationEngine,
    }) => {
      const failing = defineValidator({
        name: 'custom.always-fails',
        category: 'RESPONSE',
        severity: 'LOW',
        description: 'fails on purpose',
        toggle: 'headers',
        check: () => outcome.failed('deliberate failure'),
      });
      const dependent = defineValidator({
        name: 'custom.dependent',
        category: 'RESPONSE',
        severity: 'LOW',
        description: 'depends on the failing validator',
        toggle: 'headers',
        dependsOn: ['custom.always-fails'],
        check: () => outcome.passed('should not run'),
      });
      const engine = createValidationEngine({
        validators: validationRegistry.clone().register(failing, dependent),
        onReport: undefined,
      });

      const report = await engine.validate('health-check', { profile: 'SMOKE' });
      const status = (name: string) => report.results.find((r) => r.validatorName === name);

      expect(status('custom.always-fails')?.status).toBe('FAILED');
      expect(status('custom.dependent')).toMatchObject({
        status: 'SKIPPED',
        message: expect.stringContaining('custom.always-fails'),
      });
      expect(status('response.status-code')?.status).toBe('PASSED');
      expect(status('response.schema')?.status).toBe('PASSED');
    });

    test('response schema is SKIPPED when the body is not JSON, other validators still report', async ({
      createValidationEngine,
    }) => {
      const engine = createValidationEngine({ onReport: undefined });
      const report = await engine.validate(
        {
          id: 'plain-text-probe',
          mockFixture: true,
          method: 'GET',
          path: '/__test/plain-text',
          authentication: { required: false },
          envelope: false,
          responseSchema: z.object({ status: z.string() }),
        },
        { profile: 'SMOKE' },
      );
      const result = (name: string) => report.results.find((r) => r.validatorName === name);

      expect(result('response.schema')).toMatchObject({
        status: 'SKIPPED',
        message: expect.stringContaining('not valid JSON'),
      });
      expect(result('response.content-type')?.status).toBe('FAILED');
      expect(result('response.status-code')?.status).toBe('PASSED');
      expect(report.gate.passed).toBe(false);
    });

    test('an unregistered business rule fails loudly instead of being ignored', async ({
      createValidationEngine,
    }) => {
      const engine = createValidationEngine({ onReport: undefined });
      const report = await engine.validate(
        {
          id: 'health-with-unknown-rule',
          mockFixture: true,
          method: 'GET',
          path: '/health',
          businessRules: ['does-not-exist'],
          validations: { authentication: false, authorization: false },
        },
        { profile: 'REGRESSION' },
      );
      expect(
        report.results.find((r) => r.validatorName === 'business-rule.does-not-exist'),
      ).toMatchObject({
        status: 'FAILED',
        message: expect.stringContaining('not registered'),
      });
    });
  });
});
