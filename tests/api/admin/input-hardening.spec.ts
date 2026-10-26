import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { isPlainObject } from '@utils/json';
import { expect, test } from '@fixtures';
import {
  employeePayload,
  locationPayload,
  tierPayload,
  variablePayload,
} from './support/screen-payloads';

/**
 * Input hardening on every Admin record the screens edit (owner 2026-10-26):
 *   1. XSS on UPDATE — each free-text field updated with markup must be refused, or at least never stored
 *      and handed back verbatim (the saves already refuse markup; the updates were never probed).
 *   2. Oversized input — an oversized text value (100 KB) on save and on update must get a clean 4xx: a 5xx is a crash, a
 *      200 means the field has no length limit at all.
 * One request per case, sequential (not load). QA company 242 only; everything created is deleted. Role
 * postings are left out on purpose: their text is forwarded to KPost and live KSMACC accounts, and attack
 * payloads must not be pushed into those systems.
 */
const businessM: Principal | undefined = AUTH_PROFILES.kpost.principals.find(
  (p) => p.key === 'business-m',
);
const stamp = Date.now();
const name = (label: string): string => `QA HARDEN ${label} ${stamp}`;
const XSS = ['<script>alert(document.cookie)</script>', '<img src=x onerror=alert(1)>'];
// 100 KB by default: 1 MB sometimes got no answer at all (a timeout proves nothing). OVERSIZE_CHARS overrides.
const HUGE = 'A'.repeat(Number(process.env.OVERSIZE_CHARS ?? 100_000));
const SIZE = `${Math.round(HUGE.length / 1000)} KB`;

type Json = Record<string, unknown>;
interface Reply {
  status: number;
  text: string;
  value: unknown;
}

function setPath(obj: Json, path: string, value: unknown): Json {
  const out = JSON.parse(JSON.stringify(obj)) as Json;
  const keys = path.split('.');
  let node: Record<string, unknown> = out;
  for (const k of keys.slice(0, -1)) node = node[k] as Record<string, unknown>;
  node[keys[keys.length - 1] ?? ''] = value;
  return out;
}
function getPath(obj: unknown, path: string): unknown {
  let node: unknown = obj;
  for (const k of path.split('.'))
    node =
      isPlainObject(node) || Array.isArray(node) ? (node as Record<string, unknown>)[k] : undefined;
  return node;
}

interface RecordType {
  label: string;
  save: string;
  update: string;
  remove: string;
  arraySave: boolean;
  /** The screen's full payload; creates parents through `parent`. */
  payload: (parent: (saveId: string, p: Json) => Promise<string>) => Promise<Json>;
  /** Free-text fields an admin types into. */
  text: string[];
  /** Reads the record back by id. */
  read: { id: string; body: (id: string) => Json; pick: (value: unknown, id: string) => unknown };
}

const fromList = (value: unknown, id: string): unknown =>
  Array.isArray(value) ? value.find((r) => isPlainObject(r) && r.id === id) : undefined;

const TYPES: RecordType[] = [
  {
    label: 'Work Place tier',
    save: 'admin-workplace-tier-attribute-save',
    update: 'admin-workplace-tier-attribute-update',
    remove: 'admin-workplace-tier-attribute-delete',
    arraySave: true,
    payload: () => Promise.resolve(tierPayload(name('WP Tier'))),
    text: ['attributeName'],
    read: { id: 'admin-workplace-tier-attribute-by-company', body: () => ({}), pick: fromList },
  },
  {
    label: 'HR tier',
    save: 'admin-hr-tier-attribute-save',
    update: 'admin-hr-tier-attribute-update',
    remove: 'admin-hr-tier-attribute-delete',
    arraySave: true,
    payload: () => Promise.resolve(tierPayload(name('HR Tier'))),
    text: ['attributeName'],
    read: { id: 'admin-hr-tier-attribute-by-company', body: () => ({}), pick: fromList },
  },
  {
    label: 'Work Place variable',
    save: 'admin-workplace-tier-variable-save',
    update: 'admin-workplace-tier-variable-update',
    remove: 'admin-workplace-tier-variable-delete',
    arraySave: true,
    payload: async (parent) =>
      variablePayload(
        await parent('admin-workplace-tier-attribute-save', tierPayload(name('WP Tier'))),
        name('WP Var'),
      ),
    text: ['variableName'],
    read: {
      id: 'admin-workplace-tier-variable-list',
      body: () => ({ parentVariableId: 0 }),
      pick: fromList,
    },
  },
  {
    label: 'HR variable',
    save: 'admin-hr-tier-variable-save',
    update: 'admin-hr-tier-variable-update',
    remove: 'admin-hr-tier-variable-delete',
    arraySave: true,
    payload: async (parent) =>
      variablePayload(
        await parent('admin-hr-tier-attribute-save', tierPayload(name('HR Tier'))),
        name('HR Var'),
      ),
    text: ['variableName'],
    read: {
      id: 'admin-hr-tier-variable-list',
      body: () => ({ parentVariableId: 0 }),
      pick: fromList,
    },
  },
  {
    label: 'Workplace location',
    save: 'admin-workplace-location-save',
    update: 'admin-workplace-location-update',
    remove: 'admin-workplace-location-delete',
    arraySave: true,
    payload: async (parent) => {
      const tier = await parent(
        'admin-workplace-tier-attribute-save',
        tierPayload(name('WP Tier')),
      );
      const v = await parent(
        'admin-workplace-tier-variable-save',
        variablePayload(tier, name('WP Var')),
      );
      return locationPayload(tier, v, name('Location'));
    },
    text: ['locationName', 'addressLine1', 'addressLine2'],
    read: {
      id: 'admin-workplace-location-by-id',
      body: (id) => ({ id }),
      pick: (value) => value,
    },
  },
  {
    label: 'Employee',
    save: 'admin-employee-save',
    update: 'admin-employee-update',
    remove: 'admin-employee-delete',
    arraySave: false,
    payload: () => Promise.resolve(employeePayload(`Harden ${stamp}`)),
    text: [
      'personalInformationObj.firstName',
      'personalInformationObj.lastName',
      'residentialObj.residentialAddressLine1',
      'educationObj.0.instituteName',
    ],
    read: { id: 'admin-employee-details', body: () => ({}), pick: fromList },
  },
];

test.describe('Admin · input hardening: XSS on updates and oversized input @api @admin-api @security', () => {
  test.describe.configure({ timeout: 300_000 });
  test.skip(
    process.env.ADMIN_LIFECYCLE !== 'true',
    'writes to the QA company; set ADMIN_LIFECYCLE=true',
  );
  test.skip(
    !businessM || testData.businessMKpostId.includes('qa.business.m'),
    'needs the BUSINESS_M account of the QA testing company (QA_BUSINESS_M_KPOST_ID)',
  );

  for (const T of TYPES) {
    test(`${T.label}: updates refuse markup, and oversized input gets a clean 4xx`, async ({
      endpoints,
    }) => {
      expect(String(testData.businessMCompanyId), 'only ever the QA testing company (242)').toBe(
        '242',
      );
      const made: Array<[string, string]> = [];
      const send = async (id: string, body: unknown, label: string): Promise<Reply> => {
        const ex = await endpoints.sendTo(
          id,
          { body },
          {
            label: `harden:${T.label}:${label}`,
            auth: { principal: businessM! },
            allowLiveWrite: true,
            allowLiveRead: true,
            timeoutMs: 60_000,
          },
        );
        const text = ex.bodyText ?? '';
        let value: unknown;
        try {
          const parsed: unknown = JSON.parse(text);
          value = isPlainObject(parsed) ? parsed.value : undefined;
        } catch {
          value = undefined;
        }
        test.info().annotations.push(
          { type: label, description: `HTTP ${ex.status} ${text.slice(0, 200)}` },
          {
            type: `request ${label}`,
            description: `POST ${id} ${JSON.stringify(body).slice(0, 600)}`,
          },
        );
        return { status: ex.status, text, value };
      };
      const idOf = (value: unknown): string | undefined => {
        const rec: unknown = Array.isArray(value) ? value[0] : value;
        return isPlainObject(rec) && typeof rec.id === 'string' ? rec.id : undefined;
      };
      const parent = async (saveId: string, p: Json): Promise<string> => {
        const r = await send(saveId, [p], `parent:${saveId}`);
        const id = idOf(r.value);
        expect(id, `setup: ${saveId} (HTTP ${r.status} ${r.text.slice(0, 120)})`).toBeTruthy();
        made.push([saveId.replace(/-save$/, '-delete'), id!]);
        return id!;
      };
      const save = async (p: Json, label: string): Promise<Reply> => {
        const r = await send(T.save, T.arraySave ? [p] : p, label);
        const id = r.status < 300 ? idOf(r.value) : undefined;
        if (id) made.push([T.remove, id]);
        return r;
      };

      try {
        const full = await T.payload(parent);
        const ctl = await save(full, 'control-save');
        const id = idOf(ctl.value);
        expect(id, `BLOCKER: the screen's full payload saves (HTTP ${ctl.status})`).toBeTruthy();

        // 1. XSS on update, per free-text field.
        for (const field of T.text)
          for (const markup of XSS) {
            const label = `update-xss-${field}-${markup.slice(1, 4)}`;
            const r = await send(T.update, setPath({ ...full, id }, field, markup), label);
            let storedVerbatim = false;
            if (r.status < 400) {
              const back = await send(T.read.id, T.read.body(id!), `readback-${label}`);
              storedVerbatim = getPath(T.read.pick(back.value, id!), field) === markup;
            }
            expect
              .soft(
                storedVerbatim,
                `update of ${field} with ${markup} is refused or sanitized, not stored verbatim (HTTP ${r.status})`,
              )
              .toBe(false);
          }

        // 2. Oversized input on save and on update (the first free-text field). Opt-in while #13258 is open:
        // the server stores these minutes AFTER answering (or after the bench gave up), so records land past
        // this test's own clean-up — remove them with qa-leftovers-cleanup afterwards.
        if (process.env.ADMIN_OVERSIZE !== 'true') {
          test.info().annotations.push({
            type: 'skipped part',
            description:
              'oversized input: set ADMIN_OVERSIZE=true (#13258 open; delayed writes outlive clean-up)',
          });
          return;
        }
        const field = T.text[0]!;
        const bigSave = await save(setPath(full, field, HUGE), `save-oversize-${field}`);
        expect
          .soft(bigSave.status, `save with ${SIZE} in ${field} gets a clean 4xx (not 5xx, not 200)`)
          .toBeGreaterThanOrEqual(400);
        expect
          .soft(bigSave.status, `save with ${SIZE} in ${field} does not crash (5xx)`)
          .toBeLessThan(500);
        const bigUpdate = await send(
          T.update,
          setPath({ ...full, id }, field, HUGE),
          `update-oversize-${field}`,
        );
        expect
          .soft(
            bigUpdate.status,
            `update with ${SIZE} in ${field} gets a clean 4xx (not 5xx, not 200)`,
          )
          .toBeGreaterThanOrEqual(400);
        expect
          .soft(bigUpdate.status, `update with ${SIZE} in ${field} does not crash (5xx)`)
          .toBeLessThan(500);
      } finally {
        const left: string[] = [];
        for (const [deleteId, rid] of made.reverse()) {
          const d = await send(deleteId, { id: rid }, `cleanup:${deleteId}`).catch(() => undefined);
          if (!d || d.status !== 200) left.push(`${deleteId} ${rid}`);
        }
        expect.soft(left, 'every record this test made is deleted again').toEqual([]);
      }
    });
  }
});
