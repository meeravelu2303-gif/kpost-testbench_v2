import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { expect, test } from '@fixtures';
import {
  employeePayload,
  locationPayload,
  tierPayload,
  variablePayload,
} from '../support/screen-payloads';

const K = AUTH_PROFILES.kpost;
const businessM = K.principals.find((p) => p.key === 'business-m');
const businessS = K.principals.find((p) => p.key === 'business-s');
const stamp = Date.now();

type Json = Record<string, unknown>;

/**
 * Admin cross-tenant writes by id: every Admin update and delete names a record by `id` and takes the
 * company from the token. Company 242 (BUSINESS_M) creates a record; company 1034 (BUSINESS_S) then
 * tries to rename it and to delete it. Proof is company 242's own read-back afterwards: the record
 * must still be there, under its own name. The status code alone is not trusted (a 200 that changed
 * nothing is no leak, a 4xx after a change still is). Each kind runs only when the owner can see its
 * own record first (owner control), and everything it made is deleted in `finally`.
 */
interface Kind {
  label: string;
  save: string;
  update: string;
  remove: string;
  /** Creates the parents the record needs (tracked for clean-up); returns the save body. */
  saveBody: (made: Made, name: string) => Promise<Json | Json[]>;
  /** The update body that renames the record to `name`. */
  updateBody: (made: Made, id: string, name: string) => Json;
  /** Company 242's read that lists the record. */
  read: (id: string) => { endpoint: string; body: Json };
}

/** The record id a save answered with (`value[0].id` or `value.id`). */
function idIn(text: string | undefined): string | undefined {
  try {
    const parsed = JSON.parse(text ?? '') as { value?: unknown };
    const rec: unknown = Array.isArray(parsed.value) ? (parsed.value[0] as unknown) : parsed.value;
    const id = (rec as { id?: unknown } | undefined)?.id;
    return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
  } catch {
    return undefined;
  }
}

/** Records company 242 made in one test, deleted children first. */
class Made {
  readonly parents: Record<string, string> = {};
  private readonly made: Array<[remove: string, id: string]> = [];
  constructor(private readonly endpoints: EndpointExecutor) {}

  async create(save: string, remove: string, payload: Json | Json[]): Promise<string | undefined> {
    const ex = await this.endpoints.sendTo(
      save,
      { body: payload },
      { label: `admin:xtw-setup:${save}`, auth: { principal: businessM! }, allowLiveWrite: true },
    );
    const id = idIn(ex.bodyText);
    if (id) this.made.push([remove, id]);
    return id;
  }

  /** Company 242 deletes what it made; a record company 1034 took over is deleted with 1034's token. */
  async cleanUp(): Promise<void> {
    for (const [remove, id] of this.made.reverse())
      for (const [who, principal] of [
        ['owner', businessM!],
        ['taker', businessS!],
      ] as const) {
        const ex = await this.endpoints
          .sendTo(
            remove,
            { body: { id } },
            {
              label: `admin:xtw-cleanup-${who}:${remove}`,
              auth: { principal },
              allowLiveWrite: true,
            },
          )
          .catch(() => undefined);
        if (ex?.status === 200) break;
      }
  }
}

const wpTier = (made: Made): Promise<string | undefined> =>
  made.create('admin-workplace-tier-attribute-save', 'admin-workplace-tier-attribute-delete', [
    tierPayload(`QA XTW parent ${stamp}`),
  ]);
const hrTier = (made: Made): Promise<string | undefined> =>
  made.create('admin-hr-tier-attribute-save', 'admin-hr-tier-attribute-delete', [
    tierPayload(`QA XTW parent ${stamp}`),
  ]);

const KINDS: Kind[] = [
  {
    label: 'workplace tier',
    save: 'admin-workplace-tier-attribute-save',
    update: 'admin-workplace-tier-attribute-update',
    remove: 'admin-workplace-tier-attribute-delete',
    saveBody: (_m, name) => Promise.resolve([tierPayload(name)]),
    updateBody: (_m, id, name) => ({ id, attributeName: name }),
    read: () => ({ endpoint: 'admin-workplace-tier-attribute-by-company', body: {} }),
  },
  {
    label: 'workplace variable',
    save: 'admin-workplace-tier-variable-save',
    update: 'admin-workplace-tier-variable-update',
    remove: 'admin-workplace-tier-variable-delete',
    saveBody: async (m, name) => {
      m.parents.tier ||= (await wpTier(m)) ?? '';
      return [variablePayload(m.parents.tier, name)];
    },
    updateBody: (m, id, name) => ({ ...variablePayload(m.parents.tier!, name), id }),
    read: () => ({ endpoint: 'admin-workplace-tier-variable-list', body: { parentVariableId: 0 } }),
  },
  {
    label: 'workplace location',
    save: 'admin-workplace-location-save',
    update: 'admin-workplace-location-update',
    remove: 'admin-workplace-location-delete',
    saveBody: async (m, name) => {
      m.parents.tier ||= (await wpTier(m)) ?? '';
      m.parents.variable ||=
        (await m.create(
          'admin-workplace-tier-variable-save',
          'admin-workplace-tier-variable-delete',
          [variablePayload(m.parents.tier, `QA XTW parent var ${stamp}`)],
        )) ?? '';
      return [locationPayload(m.parents.tier, m.parents.variable, name)];
    },
    updateBody: (m, id, name) => ({
      ...locationPayload(m.parents.tier!, m.parents.variable!, name),
      id,
    }),
    read: (id) => ({ endpoint: 'admin-workplace-location-by-id', body: { id } }),
  },
  {
    label: 'HR tier',
    save: 'admin-hr-tier-attribute-save',
    update: 'admin-hr-tier-attribute-update',
    remove: 'admin-hr-tier-attribute-delete',
    saveBody: (_m, name) => Promise.resolve([tierPayload(name)]),
    updateBody: (_m, id, name) => ({ id, attributeName: name }),
    read: () => ({ endpoint: 'admin-hr-tier-attribute-by-company', body: {} }),
  },
  {
    label: 'HR variable',
    save: 'admin-hr-tier-variable-save',
    update: 'admin-hr-tier-variable-update',
    remove: 'admin-hr-tier-variable-delete',
    saveBody: async (m, name) => {
      m.parents.tier ||= (await hrTier(m)) ?? '';
      return [variablePayload(m.parents.tier, name)];
    },
    updateBody: (m, id, name) => ({ ...variablePayload(m.parents.tier!, name), id }),
    read: () => ({ endpoint: 'admin-hr-tier-variable-list', body: { parentVariableId: 0 } }),
  },
  {
    label: 'employee',
    save: 'admin-employee-save',
    update: 'admin-employee-update',
    remove: 'admin-employee-delete',
    // The employee's last name carries the marker (the screen's full record).
    saveBody: (_m, name) => Promise.resolve(employeePayload(name)),
    updateBody: (_m, id, name) => ({ ...employeePayload(name), id }),
    read: () => ({ endpoint: 'admin-employee-details', body: {} }),
  },
];

test.describe('KPost Admin · another company cannot change or delete a record by id @api @admin-api @security', () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(!businessM || !businessS, 'needs both BUSINESS_M and BUSINESS_S principals');
  test.skip(
    testData.businessMKpostId.includes('qa.business.m'),
    'needs the BUSINESS_M account (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID)',
  );

  for (const kind of KINDS) {
    test(`a ${kind.label} of company 242 cannot be renamed or deleted with company 1034's token`, async ({
      endpoints,
    }) => {
      expect(String(testData.businessMCompanyId), 'only ever the QA testing company (242)').toBe(
        '242',
      );
      if (kind.label === 'employee')
        test.skip(
          !testData.roleEmployeeMobile || !testData.roleEmployeeEmail,
          'needs the reserved QA test-employee identity in .env (QA_ROLE_EMPLOYEE_MOBILE + QA_ROLE_EMPLOYEE_EMAIL)',
        );
      const tag = kind.label.replace(/\W+/g, '-');
      // One record per probe, so a rename that moves the record cannot decide the delete probe.
      const renameMarker = `QA XTW ${kind.label} rename ${stamp}`;
      const deleteMarker = `QA XTW ${kind.label} delete ${stamp}`;
      const hijack = `QA XTW HIJACK ${kind.label} ${stamp}`;
      const made = new Made(endpoints);
      try {
        const renameId = await made.create(
          kind.save,
          kind.remove,
          await kind.saveBody(made, renameMarker),
        );
        const deleteId = await made.create(
          kind.save,
          kind.remove,
          await kind.saveBody(made, deleteMarker),
        );
        test.skip(
          !renameId || !deleteId,
          `the ${kind.label} could not be created for company 242, so nothing to probe`,
        );

        const ownerRead = async (step: string, id: string): Promise<string> => {
          const { endpoint, body } = kind.read(id);
          const ex = await endpoints.sendTo(
            endpoint,
            { body },
            {
              label: `admin:xtw-${tag}-owner-${step}`,
              auth: { principal: businessM! },
              allowLiveRead: true,
            },
          );
          return ex.status < 300 ? ex.bodyText : '';
        };
        // Owner control: without it, nothing a stranger's call leaves behind proves anything.
        // Owner control: without it, nothing a stranger's call leaves behind proves anything.
        const control = [
          await ownerRead('control', renameId!),
          await ownerRead('control', deleteId!),
        ].join('\n');
        test.skip(
          !control.includes(renameMarker) || !control.includes(deleteMarker),
          `owner control: company 242's own read does not list the new ${kind.label}, so the probe proves nothing`,
        );

        const stranger = {
          auth: { principal: businessS! },
          allowLiveRead: true,
          allowLiveWrite: true,
        };

        // 1. Company 1034 renames company 242's record. Wrong if company 242 then no longer has it
        // under its own name: renamed in place, or moved to company 1034 (seen 2026-11-03: the update
        // rewrote the record as companyId 1034).
        const updateBody = kind.updateBody(made, renameId!, hijack);
        const rename = await endpoints.sendTo(
          kind.update,
          { body: updateBody },
          { label: `admin:xtw-${tag}-cross-update`, ...stranger },
        );
        const afterRename = await ownerRead('after-update', renameId!);
        const changed = afterRename.includes(hijack) || !afterRename.includes(renameMarker);
        if (changed)
          endpoints.recordBusinessRuleViolation({
            endpointId: kind.update,
            ruleId: `IDOR-admin-cross-tenant-update-${tag}`,
            rule:
              "An update by id must check that the caller's own company owns the record: BUSINESS_S " +
              `must not rename, or take over, a ${kind.label} of BUSINESS_M by naming its id.`,
            expected: `the update is refused and company 242 keeps its ${kind.label} under its own name`,
            actual: afterRename.includes(hijack)
              ? `company 1034's update answered ${rename.status} and company 242's ${kind.label} now reads "${hijack}"`
              : `company 1034's update answered ${rename.status} (${rename.bodyText.slice(0, 160)}) and the ${kind.label} is no longer company 242's`,
            request: { body: updateBody },
          });
        expect
          .soft(
            changed,
            `company 1034 must not rename or take over company 242's ${kind.label} (HTTP ${rename.status})`,
          )
          .toBe(false);

        // 2. Company 1034 deletes another of company 242's records.
        const removal = await endpoints.sendTo(
          kind.remove,
          { body: { id: deleteId } },
          { label: `admin:xtw-${tag}-cross-delete`, ...stranger },
        );
        const gone = !(await ownerRead('after-delete', deleteId!)).includes(deleteMarker);
        if (gone)
          endpoints.recordBusinessRuleViolation({
            endpointId: kind.remove,
            ruleId: `IDOR-admin-cross-tenant-delete-${tag}`,
            rule:
              "A delete by id must check that the caller's own company owns the record: BUSINESS_S " +
              `must not delete a ${kind.label} of BUSINESS_M by naming its id.`,
            expected: `the delete is refused and company 242 still has its ${kind.label}`,
            actual: `company 1034's delete answered ${removal.status} and company 242's ${kind.label} is gone`,
            request: { body: { id: deleteId } },
          });
        expect
          .soft(
            gone,
            `company 1034 must not delete company 242's ${kind.label} (HTTP ${removal.status})`,
          )
          .toBe(false);
      } finally {
        await made.cleanUp();
      }
    });
  }
});
