import fs from 'node:fs';
import path from 'node:path';
import { apiRegistry } from '@api/definitions/index';
import { ROOT_DIR } from '@config/constants';
import { CHECK_TYPES, checkTypeOf, type CheckType } from '@engine/check-types';
import { plannedCases } from '@engine/endpoint-cases';
import { ENDPOINT_GROUPS, type ApiProduct } from '@engine/endpoint-groups';
import { resolveEndpoint } from '@engine/validation-policy';
import { validationRegistry } from '@validators/index';
import { expect, test } from '@fixtures';

/**
 * The engine's checks are reported in one folder per test type (contract/, negative/, boundary/, …).
 * Every check must belong to a type, and every type that has checks for a module must have that
 * module's engine spec, or those checks would run unreported (and the other way round: no empty spec).
 */
const specPath = (product: ApiProduct, module: string, type: CheckType): string =>
  product === 'kpost-api'
    ? path.join(ROOT_DIR, 'tests', product, type, module, `${module}-endpoints-${type}.spec.ts`)
    : path.join(ROOT_DIR, 'tests', product, type, `${module}-endpoints-${type}.spec.ts`);

/** The FULL-profile cases of one module, by type; undefined when no endpoint is registered (no host). */
function casesByType(product: ApiProduct, module: string): Map<CheckType, number> | undefined {
  const counts = new Map<CheckType, number>();
  let endpoints = 0;
  for (const group of ENDPOINT_GROUPS[product][module] ?? []) {
    for (const definition of apiRegistry.find(group.filter)) {
      endpoints += 1;
      const endpoint = resolveEndpoint(group.options?.transform?.(definition) ?? definition);
      for (const type of CHECK_TYPES)
        counts.set(type, (counts.get(type) ?? 0) + plannedCases(endpoint, 'FULL', type).length);
    }
  }
  return endpoints ? counts : undefined;
}

test.describe('engine checks are reported by test type @framework', () => {
  test('every registered validator belongs to a test type', () => {
    const unknown = validationRegistry.all().flatMap((validator) => {
      try {
        checkTypeOf(validator.name);
        return [];
      } catch (error) {
        return [(error as Error).message];
      }
    });
    expect(unknown).toEqual([]);
  });

  test('the happy path is positive, boundaries are boundary, the rest follow their category', () => {
    expect(checkTypeOf('response.status-code')).toBe('positive');
    expect(checkTypeOf('authentication.valid-token')).toBe('positive');
    expect(checkTypeOf('authentication.missing-token')).toBe('authentication');
    expect(checkTypeOf('request.boundary-value')).toBe('boundary');
    expect(checkTypeOf('request.required-fields')).toBe('negative');
    expect(checkTypeOf('response.schema')).toBe('contract');
    expect(checkTypeOf('common.date')).toBe('contract');
    expect(checkTypeOf('database.kpost-message-row')).toBe('data-integrity');
    expect(checkTypeOf('business-rule.BR-C01')).toBe('business-rules');
    expect(checkTypeOf('concurrency.read-consistency')).toBe('concurrency');
    expect(() => checkTypeOf('brand-new.check')).toThrow(/has no test type/);
  });

  for (const [product, modules] of Object.entries(ENDPOINT_GROUPS) as [
    ApiProduct,
    (typeof ENDPOINT_GROUPS)[ApiProduct],
  ][]) {
    for (const module of Object.keys(modules)) {
      test(`${product} ${module}: an engine spec exactly for each type that has checks`, () => {
        const counts = casesByType(product, module);
        test.skip(
          !counts,
          `no ${product} endpoint is registered here (its host is not configured)`,
        );
        const problems = CHECK_TYPES.flatMap((type) => {
          const file = path.relative(ROOT_DIR, specPath(product, module, type));
          const exists = fs.existsSync(specPath(product, module, type));
          const cases = counts?.get(type) ?? 0;
          if (cases && !exists) return [`${file} is missing (${cases} ${type} checks unreported)`];
          if (!cases && exists) return [`${file} reports no checks: delete it`];
          return [];
        });
        expect(problems).toEqual([]);
      });
    }
  }
});
