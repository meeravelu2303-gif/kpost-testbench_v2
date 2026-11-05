import { apiRegistry } from '@api/definitions/index';
import {
  limitSteps,
  sourceLimitIds,
  sourceLimits,
  type LimitSection,
} from '@api/contract/source-limits';
import { toJsonSchema, type JsonSchema } from '@api/schema/contract-schema';
import type { SuiteId } from '@config/ownership.config';
import { resolveEndpoint } from '@engine/validation-policy';
import { isPlainObject } from '@utils/json';
import { expect, test } from '@fixtures';

/**
 * The input limits read from the backend source (`src/api/contract/source/<suite>.limits.json`):
 * every entry names a real endpoint, cites the code it came from, is a sane number, and lands in
 * the schema the boundary validators read. KDoc/KOS is excluded from testing.
 */
const SUITES: readonly SuiteId[] = ['kpost-api', 'kmail-api', 'admin-api'];
const EXCLUDED = /^(kos|kword|kdoc)-/;

function schemaAt(
  schema: JsonSchema | undefined,
  steps: readonly string[],
): JsonSchema | undefined {
  let at = schema;
  for (const step of steps) {
    if (!at) return undefined;
    const next: unknown =
      step === '[]'
        ? at.items
        : isPlainObject(at.properties)
          ? (at.properties as Record<string, unknown>)[step]
          : undefined;
    at = isPlainObject(next) ? next : undefined;
  }
  return at;
}

const SECTION_SCHEMA = {
  body: 'requestSchema',
  query: 'querySchema',
  path: 'pathParamsSchema',
} as const satisfies Record<LimitSection, string>;

test.describe('Backend-source input limits @framework', () => {
  for (const suite of SUITES) {
    test(`${suite}: every entry names a registered endpoint of the suite, none excluded`, () => {
      const strays = sourceLimitIds(suite).filter(
        (id) => !apiRegistry.has(id) || apiRegistry.get(id).suite !== suite || EXCLUDED.test(id),
      );
      expect(strays, 'limit entries with no in-scope endpoint').toEqual([]);
    });

    test(`${suite}: every limit cites its source and is a sane number`, () => {
      const bad: string[] = [];
      for (const id of sourceLimitIds(suite)) {
        for (const [field, limits] of Object.entries(sourceLimits(suite, id)!)) {
          if (!/^(body|query|path)\./.test(field)) bad.push(`${id} ${field}: unknown section`);
          for (const [keyword, limit] of Object.entries(limits)) {
            if (!limit.source || !/:\d+/.test(limit.source) || !limit.from)
              bad.push(`${id} ${field} ${keyword}: no file:line citation`);
            if (!Number.isInteger(limit.value) || limit.value < 0)
              bad.push(`${id} ${field} ${keyword}: ${limit.value} is not a non-negative integer`);
          }
          const min = limits.minLength?.value ?? limits.minItems?.value ?? limits.minimum?.value;
          const max = limits.maxLength?.value ?? limits.maxItems?.value ?? limits.maximum?.value;
          if (min !== undefined && max !== undefined && min > max)
            bad.push(`${id} ${field}: min ${min} > max ${max}`);
        }
      }
      expect(bad).toEqual([]);
    });

    test(`${suite}: each limit lands in the schema the boundary validators read`, () => {
      const missing: string[] = [];
      const noSchema = new Set<string>();
      let landed = 0;
      for (const id of sourceLimitIds(suite)) {
        if (!apiRegistry.has(id)) continue;
        const resolved = resolveEndpoint(apiRegistry.get(id));
        for (const [field, limits] of Object.entries(sourceLimits(suite, id)!)) {
          const dot = field.indexOf('.');
          const section = field.slice(0, dot) as LimitSection;
          const raw = resolved[SECTION_SCHEMA[section]];
          // An endpoint with no schema for the section is left alone (a limit never invents one).
          if (!raw) {
            noSchema.add(`${id} (${section})`);
            continue;
          }
          const at = schemaAt(toJsonSchema(raw), limitSteps(field.slice(dot + 1)));
          for (const [keyword, limit] of Object.entries(limits)) {
            if (at?.[keyword] === limit.value) landed++;
            else missing.push(`${id} ${field} ${keyword}`);
          }
        }
      }
      test.info().annotations.push({
        type: 'coverage',
        description: `${landed} limits in effect; endpoints with no request schema to carry them: ${[...noSchema].join(', ') || 'none'}`,
      });
      expect(missing, 'limits that did not reach the schema').toEqual([]);
      expect(landed, 'limits in effect').toBeGreaterThan(0);
    });
  }
});
