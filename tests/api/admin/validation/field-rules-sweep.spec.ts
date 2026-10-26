import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { isPlainObject } from '@utils/json';
import { expect, test } from '@fixtures';

/**
 * Field rules, both directions, on every Admin record the screens create (owner 2026-10-26: find every bug in
 * one pass). For each record type, from the screen's OWN full payload and the screen's OWN rules
 * (ADMIN_HR_MODULES_25):
 *   1. control: the full payload saves, and every field reads back as sent;
 *   2. each field the screen requires, left out → save must refuse (400);
 *   3. each field the screen leaves optional, blank → save AND update must accept;
 *   4. a complete update is accepted; an update without a required field is refused;
 *   5. ordinary words in names/addresses ("Union", "Select", "--") are accepted.
 * Every case runs (soft checks); every record is deleted. QA testing company 242 only. Role postings are
 * left out: their writes create KPost/KSMACC accounts (role-posting-lifecycle.spec.ts).
 */
const businessM: Principal | undefined = AUTH_PROFILES.kpost.principals.find(
  (p) => p.key === 'business-m',
);
const stamp = Date.now();
const name = (label: string): string => `QA SWEEP ${label} ${stamp}`;

type Json = Record<string, unknown>;
interface Reply {
  status: number;
  text: string;
  id?: string;
}

// ---- small path helpers (dotted, numeric segments index arrays) ----------------------------------
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function setPath(obj: Json, path: string, value: unknown): Json {
  const out = clone(obj);
  const keys = path.split('.');
  let node: Record<string, unknown> = out;
  for (const k of keys.slice(0, -1)) node = node[k] as Record<string, unknown>;
  const last = keys[keys.length - 1] ?? '';
  if (value === undefined) delete node[last];
  else node[last] = value;
  return out;
}
function getPath(obj: unknown, path: string): unknown {
  let node: unknown = obj;
  for (const k of path.split('.'))
    node =
      isPlainObject(node) || Array.isArray(node) ? (node as Record<string, unknown>)[k] : undefined;
  return node;
}
/** A leaf value as text: numbers and strings compare equal (the server stores ids as strings). */
const asText = (v: unknown): string => {
  if (v === undefined || v === null) return '(missing)';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
};
/** Every leaf path of a payload (scalars only). */
function leaves(obj: unknown, prefix = ''): string[] {
  if (Array.isArray(obj)) return obj.flatMap((v, i) => leaves(v, `${prefix}${i}.`));
  if (isPlainObject(obj))
    return Object.entries(obj).flatMap(([k, v]) => leaves(v, `${prefix}${k}.`));
  return [prefix.slice(0, -1)];
}

interface RecordType {
  label: string;
  save: string;
  update: string;
  remove: string;
  /** Saves take an array of one (`[payload]`); updates a single object with `id`. */
  arraySave: boolean;
  /** Builds the screen's full payload (may create parent records through `parent`). */
  payload: (
    parent: (saveId: string, p: Json, arraySave?: boolean) => Promise<string>,
  ) => Promise<Json>;
  required: string[];
  optional: string[];
  /** Free-text fields that must take ordinary words. */
  text: string[];
  /** Reads the saved record back, or undefined when this type has no read-back. */
  readBack?: (send: Send, id: string, payload: Json) => Promise<unknown>;
  /** Leaf paths the server does not echo by design (derived or token-scoped); skipped in the read-back. */
  notEchoed?: RegExp;
  /**
   * Fields left out of the update checks after their own finding is recorded, so one rejected field does not
   * mask every other update case (Employee: the update refuses the whole request when it carries aadharcard).
   */
  updateDrops?: string[];
}
type Send = (id: string, body: unknown, label: string) => Promise<Reply>;

const tierPayload = (label: string): Json => ({ attributeName: name(label) });
const listRow = async (send: Send, listId: string, body: Json, id: string): Promise<unknown> => {
  const r = await send(listId, body, `readback:${listId}`);
  const parsed: unknown = JSON.parse(r.text || '{}');
  const rows = isPlainObject(parsed) && Array.isArray(parsed.value) ? parsed.value : [];
  return rows.find((x) => isPlainObject(x) && x.id === id);
};

const TYPES: RecordType[] = [
  {
    label: 'Work Place tier',
    save: 'admin-workplace-tier-attribute-save',
    update: 'admin-workplace-tier-attribute-update',
    remove: 'admin-workplace-tier-attribute-delete',
    arraySave: true,
    payload: () => Promise.resolve(tierPayload('WP Tier')),
    required: ['attributeName'],
    optional: [],
    text: ['attributeName'],
    readBack: (send, id) => listRow(send, 'admin-workplace-tier-attribute-by-company', {}, id),
  },
  {
    label: 'HR tier',
    save: 'admin-hr-tier-attribute-save',
    update: 'admin-hr-tier-attribute-update',
    remove: 'admin-hr-tier-attribute-delete',
    arraySave: true,
    payload: () => Promise.resolve(tierPayload('HR Tier')),
    required: ['attributeName'],
    optional: [],
    text: ['attributeName'],
    readBack: (send, id) => listRow(send, 'admin-hr-tier-attribute-by-company', {}, id),
  },
  {
    label: 'Work Place variable',
    save: 'admin-workplace-tier-variable-save',
    update: 'admin-workplace-tier-variable-update',
    remove: 'admin-workplace-tier-variable-delete',
    arraySave: true,
    payload: async (parent) => ({
      variableName: name('WP Var'),
      attributeId: await parent('admin-workplace-tier-attribute-save', tierPayload('WP Tier')),
      parentVariableId: 0,
      parentAttributeId: 0,
      reportingJson: '[]',
    }),
    required: ['variableName', 'attributeId', 'parentVariableId'],
    optional: [],
    text: ['variableName'],
    readBack: (send, id) =>
      listRow(send, 'admin-workplace-tier-variable-list', { parentVariableId: 0 }, id),
  },
  {
    label: 'HR variable',
    save: 'admin-hr-tier-variable-save',
    update: 'admin-hr-tier-variable-update',
    remove: 'admin-hr-tier-variable-delete',
    arraySave: true,
    payload: async (parent) => ({
      variableName: name('HR Var'),
      attributeId: await parent('admin-hr-tier-attribute-save', tierPayload('HR Tier')),
      parentVariableId: 0,
      parentAttributeId: 0,
      reportingJson: '[]',
    }),
    required: ['variableName', 'attributeId', 'parentVariableId'],
    optional: [],
    text: ['variableName'],
    readBack: (send, id) =>
      listRow(send, 'admin-hr-tier-variable-list', { parentVariableId: 0 }, id),
  },
  {
    // WorkPlaceLocationSetup.js:1228-1236 — tiers, name, country, 6-digit pincode, state, city, area
    // required; Address 1 and Address 2 optional (their checks are commented out).
    label: 'Workplace location',
    save: 'admin-workplace-location-save',
    update: 'admin-workplace-location-update',
    remove: 'admin-workplace-location-delete',
    arraySave: true,
    payload: async (parent) => {
      const attributeId = await parent(
        'admin-workplace-tier-attribute-save',
        tierPayload('WP Tier'),
      );
      const variableId = await parent('admin-workplace-tier-variable-save', {
        variableName: name('WP Var'),
        attributeId,
        parentVariableId: 0,
        parentAttributeId: 0,
        reportingJson: '[]',
      });
      return {
        attributeId,
        variableId,
        workPlaceLocation: JSON.stringify([
          { attributeId, variableId, variableName: name('WP Var') },
        ]),
        reportingWorkplaceLocation: '[{"variableId":"0","workplaceLocationId":"0"}]',
        reportingWorkplaceLocationId: '0',
        locationName: name('Location'),
        pincode: testData.pinCode,
        state: 'Tamil Nadu',
        city: 'Chennai',
        area: 'Chennai',
        addressLine1: 'QA bench street',
        addressLine2: 'QA bench area',
        countryId: 1,
        countryName: 'India',
      };
    },
    required: [
      'attributeId',
      'variableId',
      'locationName',
      'countryName',
      'pincode',
      'state',
      'city',
      'area',
    ],
    optional: ['addressLine1', 'addressLine2'],
    text: ['locationName', 'addressLine1', 'addressLine2'],
    readBack: async (send, id) => {
      const r = await send('admin-workplace-location-by-id', { id }, 'readback:location');
      const parsed: unknown = JSON.parse(r.text || '{}');
      return isPlainObject(parsed) ? parsed.value : undefined;
    },
  },
  {
    // ManualEntry.js:261-420 — the six steps' required fields; landline, marital status, the alternative
    // mobile/e-mail and the mailing block (copied from residential) are optional.
    label: 'Employee',
    save: 'admin-employee-save',
    update: 'admin-employee-update',
    remove: 'admin-employee-delete',
    arraySave: false,
    payload: () =>
      Promise.resolve({
        personalInformationObj: {
          firstName: 'QA',
          lastName: `Sweep ${stamp}`,
          dob: '1990-01-15',
          gender: 'Male',
          maritalStatus: 'Single',
          landline: '0442345678',
          mobile: testData.roleEmployeeMobile,
          alternativeMobileNo: testData.roleEmployeeMobile,
          emailAddress: testData.roleEmployeeEmail,
          alternativeEmailAddress: testData.roleEmployeeEmail,
          nationality: 'India',
          disability: false,
        },
        residentialObj: {
          residentialCountry: 'India',
          residentialZipCode: testData.pinCode,
          residentialState: 'Tamil Nadu',
          residentialCity: 'Chennai',
          residentialArea: 'Chennai',
          residentialAddressLine1: 'QA bench street',
          residentialAddressLine2: 'QA bench area',
        },
        mailingObj: {
          mailingCountry: 'India',
          mailingZipCode: testData.pinCode,
          mailingState: 'Tamil Nadu',
          mailingCity: 'Chennai',
          mailingArea: 'Chennai',
          mailingAddressLine1: 'QA bench street',
          mailingAddressLine2: 'QA bench area',
        },
        employmentObj: {
          hrJson: '[]',
          reportingHrJson: '[]',
          employmentStatus: 'Self-employed',
          dateOfJoining: '2026-10-26',
        },
        educationObj: [
          {
            qualification: "Master's Degree (Postgraduate)",
            instituteName: 'QA Institute',
            percentage: '75',
            yearOfGraduation: '2012-05-31',
          },
        ],
        workExpObj: { isExperienced: 'No' },
        additionalObj: {
          nationality: 'India',
          citizenship: 'India',
          panCard: 'ABCPE1234F',
          aadharcard: '234123412346',
        },
      }),
    required: [
      'personalInformationObj.firstName',
      'personalInformationObj.lastName',
      'personalInformationObj.dob',
      'personalInformationObj.gender',
      'personalInformationObj.mobile',
      'personalInformationObj.emailAddress',
      'personalInformationObj.nationality',
      'residentialObj.residentialCountry',
      'residentialObj.residentialZipCode',
      'residentialObj.residentialState',
      'residentialObj.residentialCity',
      'residentialObj.residentialArea',
      'residentialObj.residentialAddressLine1',
      'residentialObj.residentialAddressLine2',
      'employmentObj.employmentStatus',
      'employmentObj.dateOfJoining',
      'educationObj.0.qualification',
      'educationObj.0.instituteName',
      'educationObj.0.percentage',
      'educationObj.0.yearOfGraduation',
      'workExpObj.isExperienced',
      'additionalObj.nationality',
      'additionalObj.citizenship',
      'additionalObj.panCard',
      'additionalObj.aadharcard',
    ],
    optional: [
      'personalInformationObj.landline',
      'personalInformationObj.maritalStatus',
      'personalInformationObj.alternativeMobileNo',
      'personalInformationObj.alternativeEmailAddress',
      'mailingObj.mailingAddressLine2',
    ],
    text: [
      'personalInformationObj.lastName',
      'residentialObj.residentialAddressLine1',
      'educationObj.0.instituteName',
    ],
    readBack: (send, id) => listRow(send, 'admin-employee-details', {}, id),
  },
];

/** Ordinary values a real company uses, which a crude keyword filter would refuse. */
const ORDINARY_WORDS = ['Union Road', 'Select Grade', 'Updated Wing', 'Block A--East'];

test.describe('Admin · field rules, both directions, on every record type @api @admin-api', () => {
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
    test(`${T.label}: save and update follow the screen's field rules`, async ({ endpoints }) => {
      expect(String(testData.businessMCompanyId), 'only ever the QA testing company (242)').toBe(
        '242',
      );
      const made: Array<[string, string]> = [];
      const send: Send = async (id, payload, label) => {
        const ex = await endpoints.sendTo(
          id,
          { body: payload },
          {
            label: `sweep:${T.label}:${label}`,
            auth: { principal: businessM! },
            allowLiveWrite: true,
            allowLiveRead: true,
          },
        );
        const text = ex.bodyText ?? '';
        let rid: string | undefined;
        try {
          const parsed: unknown = JSON.parse(text);
          const value = isPlainObject(parsed) ? parsed.value : undefined;
          const rec: unknown = Array.isArray(value) ? value[0] : value;
          rid = isPlainObject(rec) && typeof rec.id === 'string' ? rec.id : undefined;
        } catch {
          rid = undefined;
        }
        test.info().annotations.push(
          { type: `${label}`, description: `HTTP ${ex.status} ${text.slice(0, 160)}` },
          // The exact request, so a filed bug's curl carries the real data.
          { type: `request ${label}`, description: `POST ${id} ${JSON.stringify(payload)}` },
        );
        return { status: ex.status, text, id: rid };
      };
      const save = async (p: Json, label: string): Promise<Reply> => {
        const r = await send(T.save, T.arraySave ? [p] : p, label);
        if (r.status < 300 && r.id) made.push([T.remove, r.id]);
        return r;
      };
      const parent = async (saveId: string, p: Json, arraySave = true): Promise<string> => {
        const r = await send(saveId, arraySave ? [p] : p, `parent:${saveId}`);
        expect(r.id, `setup: ${saveId} (HTTP ${r.status} ${r.text.slice(0, 120)})`).toBeTruthy();
        made.push([saveId.replace(/-save$/, '-delete'), r.id!]);
        return r.id!;
      };

      try {
        const full = await T.payload(parent);

        // 1. control + read-back
        const ctl = await save(full, 'control-save');
        expect(ctl.status, "BLOCKER: the screen's full payload saves").toBe(200);
        expect(ctl.id, 'and returns the new id').toBeTruthy();
        if (T.readBack) {
          const back = await T.readBack(send, ctl.id!, full);
          expect.soft(back, 'the saved record can be read back').toBeTruthy();
          for (const leaf of leaves(full)) {
            if (T.notEchoed?.test(leaf)) continue;
            expect
              .soft(asText(getPath(back, leaf)), `read-back keeps ${leaf}`)
              .toBe(asText(getPath(full, leaf)));
          }
        }

        // 4a. the screen's complete update is accepted (exactly the saved payload)
        const upd = await send(T.update, { ...full, id: ctl.id }, 'control-update');
        expect.soft(upd.status, "the screen's complete update is accepted").toBe(200);
        // The base for the remaining update cases, without fields whose own finding is recorded above.
        const updBase = (T.updateDrops ?? []).reduce(
          (p, path) => setPath(p, path, undefined),
          full,
        );

        // 2 + 4b. required fields: missing → save AND update refuse
        for (const field of T.required) {
          const r = await save(setPath(full, field, undefined), `save-without-${field}`);
          expect.soft(r.status, `save without required ${field} is refused`).toBe(400);
          const u = await send(
            T.update,
            setPath({ ...updBase, id: ctl.id }, field, undefined),
            `update-without-${field}`,
          );
          expect.soft(u.status, `update without required ${field} is refused`).toBe(400);
        }

        // 3. optional fields: blank → save AND update accept
        for (const field of T.optional) {
          const r = await save(setPath(full, field, ''), `save-blank-${field}`);
          expect.soft(r.status, `save with optional ${field} blank is accepted`).toBe(200);
          if (r.id) {
            const u = await send(
              T.update,
              setPath({ ...updBase, id: r.id }, field, ''),
              `update-blank-${field}`,
            );
            expect.soft(u.status, `update with optional ${field} blank is accepted`).toBe(200);
          }
        }

        // 5. ordinary words in free text
        for (const field of T.text)
          for (const words of ORDINARY_WORDS) {
            const value = `QA ${words} ${stamp}`;
            const r = await save(setPath(full, field, value), `save-words-${field}-${words}`);
            expect.soft(r.status, `save accepts "${words}" in ${field}`).toBe(200);
          }
      } finally {
        const left: string[] = [];
        for (const [deleteId, id] of made.reverse()) {
          const d = await send(deleteId, { id }, `cleanup:${deleteId}`).catch(() => undefined);
          if (!d || d.status !== 200) left.push(`${deleteId} ${id}`);
        }
        expect.soft(left, 'every record this test made is deleted again').toEqual([]);
      }
    });
  }
});
