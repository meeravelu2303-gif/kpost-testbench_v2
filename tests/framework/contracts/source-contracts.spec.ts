import { apiRegistry } from '@api/definitions/index';
import {
  isAdopted,
  sourceContractEntry,
  sourceContractIds,
  sourceResponseSchema,
} from '@api/contract/source-contract';
import { validateSchema } from '@api/schema/contract-schema';
import type { SuiteId } from '@config/ownership.config';
import { expect, test } from '@fixtures';

/**
 * The response contracts read from the backend source (`src/api/contract/source/`): every entry
 * names a real endpoint, cites the code it came from, and compiles; every endpoint the workbook
 * leaves without a response schema has one (KDoc/KOS is excluded from testing).
 */
const SUITES: readonly SuiteId[] = ['kpost-api', 'kmail-api'];
const EXCLUDED = /^(kos|kword|kdoc)-/;

test.describe('Backend-source response contracts @framework', () => {
  for (const suite of SUITES) {
    test(`${suite}: every entry names a registered endpoint of the suite`, () => {
      const strays = sourceContractIds(suite).filter(
        (id) => !apiRegistry.has(id) || apiRegistry.get(id).suite !== suite,
      );
      expect(strays, 'source entries with no endpoint').toEqual([]);
    });

    test(`${suite}: every entry cites its controller method and evidence`, () => {
      const uncited = sourceContractIds(suite).filter((id) => {
        const entry = sourceContractEntry(suite, id)!;
        return !entry.handler || entry.evidence.length === 0;
      });
      // A "not found in the source" entry has no evidence by definition.
      const notFound = uncited.filter((id) =>
        sourceContractEntry(suite, id)!.handler.startsWith('not found'),
      );
      expect(
        uncited.filter((id) => !notFound.includes(id)),
        'entries without a citation',
      ).toEqual([]);
    });

    test(`${suite}: every schema compiles and accepts no wrong-typed body`, () => {
      for (const id of sourceContractIds(suite)) {
        const entry = sourceContractEntry(suite, id)!;
        for (const schema of [entry.dataSchema, entry.topLevel])
          if (schema) expect(() => validateSchema(schema, null), id).not.toThrow();
      }
    });

    test(`${suite}: every endpoint the workbook leaves without a response has a source entry`, () => {
      const missing = apiRegistry
        .all()
        .filter((d) => d.suite === suite && d.envelope !== false && !EXCLUDED.test(d.id))
        .filter((d) => !d.responseSchema && !sourceContractEntry(suite, d.id))
        .map((d) => d.id);
      expect(missing, 'no response contract from the workbook or the source').toEqual([]);
    });

    test(`${suite}: an adopted entry becomes the endpoint's schema, with its source cited`, () => {
      for (const id of sourceContractIds(suite)) {
        const entry = sourceContractEntry(suite, id)!;
        const built = sourceResponseSchema(suite, id);
        if (!isAdopted(entry)) {
          expect(built, `${id} is not used until a live response matched it`).toBeUndefined();
          continue;
        }
        if (!built) continue;
        expect(built.source, id).toContain(entry.handler);
        const definition = apiRegistry.get(id);
        if (definition.responseSchemaSource)
          expect(definition.responseSchemaSource, id).toBe(built.source);
      }
    });
  }
});
