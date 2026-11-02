import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { expect, test } from '@fixtures';
import { tierPayload, variablePayload } from '../support/screen-payloads';

/**
 * A short tier or variable name gets a clean answer, never a 500. The abbreviation builders
 * (CreateAbbreviationAndCodeFor*.java ~20) cut the first three letters of a one-word name, so a
 * name under 3 characters (or a two-word name whose first word is 1 character) throws before
 * saveAll. Valid input is checked too: a 3-letter name saves. QA company 242 only; whatever is
 * created is deleted by its returned id.
 */
const businessM: Principal | undefined = AUTH_PROFILES.kpost.principals.find(
  (p) => p.key === 'business-m',
);
const stamp = Date.now();

const TYPES = [
  {
    label: 'Work Place tier',
    save: 'admin-workplace-tier-attribute-save',
    remove: 'admin-workplace-tier-attribute-delete',
    field: 'attributeName',
    parent: undefined,
  },
  {
    label: 'HR tier',
    save: 'admin-hr-tier-attribute-save',
    remove: 'admin-hr-tier-attribute-delete',
    field: 'attributeName',
    parent: undefined,
  },
  {
    label: 'Work Place variable',
    save: 'admin-workplace-tier-variable-save',
    remove: 'admin-workplace-tier-variable-delete',
    field: 'variableName',
    parent: {
      save: 'admin-workplace-tier-attribute-save',
      remove: 'admin-workplace-tier-attribute-delete',
    },
  },
  {
    label: 'HR variable',
    save: 'admin-hr-tier-variable-save',
    remove: 'admin-hr-tier-variable-delete',
    field: 'variableName',
    parent: { save: 'admin-hr-tier-attribute-save', remove: 'admin-hr-tier-attribute-delete' },
  },
] as const;

/** Short names the abbreviation code cannot handle, and a short valid one. */
const SHORT = ['Q', 'QA', 'Q Tier'] as const;

const idsOf = (text: string): string[] => {
  try {
    const value = (JSON.parse(text) as { value?: unknown }).value;
    return Array.isArray(value)
      ? value
          .map((r) => (r as { id?: unknown }).id)
          .filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
};

test.describe(
  'KPost Admin · a short tier or variable name is answered cleanly @api @admin-api',
  { tag: ['@api', '@admin', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default', timeout: 240_000 });
    test.skip(!businessM, 'needs the BUSINESS_M principal (QA company 242)');

    for (const type of TYPES) {
      test(`${type.label}: names shorter than the abbreviation needs get a 4xx, and a 3-letter name saves`, async ({
        endpoints,
      }) => {
        const as = { auth: { principal: businessM! }, allowLiveWrite: true };
        const created: { remove: string; id: string }[] = [];
        const save = async (id: string, body: Record<string, unknown>, label: string) => {
          const res = await endpoints.sendTo(id, { body: [body] }, { label, ...as });
          for (const saved of idsOf(res.bodyText)) created.push({ remove: '', id: saved });
          return res;
        };
        try {
          let parentId: string | undefined;
          if (type.parent) {
            const parent = await save(
              type.parent.save,
              tierPayload(`QA SHORT parent ${stamp}`),
              `admin:short:${type.label}:parent`,
            );
            parentId = idsOf(parent.bodyText)[0];
            const parentRow = created.at(-1);
            if (parentRow) parentRow.remove = type.parent.remove;
            expect(parentId, 'BLOCKED: needs a parent level to hold the variable').toBeTruthy();
          }
          const payload = (value: string) =>
            parentId ? variablePayload(parentId, value) : tierPayload(value);

          for (const value of SHORT) {
            const before = created.length;
            const res = await save(type.save, payload(value), `admin:short:${type.label}:${value}`);
            for (const c of created.slice(before)) c.remove = type.remove;
            expect
              .soft(
                res.status,
                `${type.label} named "${value}": a clean answer, not a server error`,
              )
              .toBeLessThan(500);
          }
          const before = created.length;
          const valid = await save(type.save, payload('QAS'), `admin:short:${type.label}:valid`);
          for (const c of created.slice(before)) c.remove = type.remove;
          expect.soft(valid.status, `${type.label} named "QAS" (3 letters) saves`).toBe(200);
        } finally {
          // Children first: delete in reverse order of creation.
          for (const c of [...created].reverse()) {
            await endpoints
              .sendTo(
                c.remove,
                { body: { id: c.id } },
                { label: `admin:short:cleanup:${c.id}`, ...as },
              )
              .catch(() => undefined);
          }
        }
      });
    }
  },
);
