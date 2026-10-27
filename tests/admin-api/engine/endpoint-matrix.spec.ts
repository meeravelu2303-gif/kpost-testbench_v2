import { apiRegistry } from '@api/definitions/index';
import { body } from '@api/definitions/kpost/kpost-endpoint';
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import type { ValidationEngine } from '@engine/validation-engine';
import { formatReport } from '@reporting/report-formatter';
import { isPlainObject } from '@utils/json';
import { expect, test } from '@fixtures';
import { employeePayload } from '../support/screen-payloads';
import { KNOWN_FALSE_POSITIVES } from '../../../src/bug-tracker/gates/known-false-positives';

/**
 * Runs the engine on the Admin writes and id-keyed reads it cannot reach alone (not productionSafe,
 * placeholder bodies). Each test creates its records in the QA company, runs the engine with the
 * screen's payload naming them, then deletes everything. Only that one call is cloned productionSafe;
 * every other guard stays armed.
 */
const businessM: Principal | undefined = AUTH_PROFILES.kpost.principals.find(
  (p) => p.key === 'business-m',
);
const stamp = Date.now();
const name = (label: string): string => `QA MATRIX ${label} ${stamp}`;

type Json = Record<string, unknown>;

/** The record id a save/create answered with (`value[0].id` or `value.id`), from a response body. */
function idIn(text: string | undefined): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text ?? '');
    const value = isPlainObject(parsed) ? parsed.value : undefined;
    const rec: unknown = Array.isArray(value) ? value[0] : value;
    return isPlainObject(rec) && typeof rec.id === 'string' ? rec.id : undefined;
  } catch {
    return undefined;
  }
}

class Records {
  private readonly made: Array<[deleteId: string, id: string]> = [];
  constructor(private readonly endpoints: EndpointExecutor) {}

  async create(saveId: string, payload: unknown): Promise<string> {
    const ex = await this.endpoints.sendTo(
      saveId,
      { body: payload },
      { label: `matrix:setup:${saveId}`, auth: { principal: businessM! }, allowLiveWrite: true },
    );
    const id = idIn(ex.bodyText);
    expect(
      id,
      `setup: ${saveId} created a record (HTTP ${ex.status} ${(ex.bodyText ?? '').slice(0, 160)})`,
    ).toBeTruthy();
    this.track(saveId.replace(/-save$/, '-delete'), id!);
    return id!;
  }

  track(deleteId: string, id: string): void {
    this.made.push([deleteId, id]);
  }

  /** Children first (reverse creation order); a record the test itself deleted answers non-200 — fine. */
  async cleanUp(): Promise<void> {
    for (const [deleteId, id] of this.made.reverse())
      await this.endpoints
        .sendTo(
          deleteId,
          { body: { id } },
          {
            label: `matrix:cleanup:${deleteId}`,
            auth: { principal: businessM! },
            allowLiveWrite: true,
          },
        )
        .catch(() => undefined);
  }
}

/** Run the engine on `endpointId` with a real body; returns the primary response text. */
async function engineOn(
  validationEngine: ValidationEngine,
  endpointId: string,
  payload: Json | Json[],
): Promise<string | undefined> {
  const definition = {
    ...apiRegistry.get(endpointId),
    productionSafe: true,
    request: body(() => payload),
  };
  const report = await validationEngine.validate(definition);
  // A result judged not a defect (known-false-positives.ts, by endpoint + check) does not fail the matrix.
  const judged = (validator: string): boolean =>
    KNOWN_FALSE_POSITIVES.some(
      (k) =>
        !k.fingerprint &&
        k.validator === validator &&
        k.endpoint !== undefined &&
        definition.path.includes(k.endpoint),
    );
  expect
    .soft(
      report.gate.blocking.filter((v) => !judged(v)),
      formatReport(report),
    )
    .toEqual([]);
  return report.primary?.body;
}

// The screens' own payloads (ADMIN_HR_MODULES_25), naming records the test created.
const wpVarBody = (attributeId: string, label = 'WP Var'): Json => ({
  variableName: name(label),
  attributeId,
  parentVariableId: 0,
  parentAttributeId: 0,
  reportingJson: '[]',
});
const hrVarBody = (attributeId: string, label = 'HR Var'): Json => ({
  variableName: name(label),
  attributeId,
  parentVariableId: 0,
  parentAttributeId: 0,
  reportingJson: '[]',
});
const locationBody = (attributeId: string, variableId: string, label = 'Location'): Json => ({
  attributeId,
  variableId,
  workPlaceLocation: JSON.stringify([{ attributeId, variableId, variableName: name('WP Var') }]),
  reportingWorkplaceLocation: '[{"variableId":"0","workplaceLocationId":"0"}]',
  reportingWorkplaceLocationId: '0',
  locationName: name(label),
  pincode: testData.pinCode,
  state: 'Tamil Nadu',
  city: 'Chennai',
  area: 'Chennai',
  addressLine1: 'QA bench street',
  addressLine2: 'QA bench area',
  countryId: 1,
  countryName: 'India',
});
// The Employee Data screen's full record (the server enforces its required fields).
const employeeBody = (label: string): Json => employeePayload(`Matrix ${label} ${stamp}`);

interface Case {
  endpointId: string;
  /** Builds the request from records it creates (tracked for clean-up). */
  request: (r: Records) => Promise<Json | Json[]>;
  /** For saves: the delete endpoint for the record the engine's own request creates. */
  createsWith?: string;
}

const CASES: Case[] = [
  // ---- Work Place Setup: tiers -----------------------------------------------------------
  {
    endpointId: 'admin-workplace-tier-attribute-save',
    request: () => Promise.resolve([{ attributeName: name('WP Tier') }]),
    createsWith: 'admin-workplace-tier-attribute-delete',
  },
  {
    endpointId: 'admin-workplace-tier-attribute-update',
    request: async (r) => ({
      id: await r.create('admin-workplace-tier-attribute-save', [
        { attributeName: name('WP Tier') },
      ]),
      attributeName: name('WP Tier edited'),
    }),
  },
  {
    endpointId: 'admin-workplace-tier-attribute-delete',
    request: async (r) => ({
      id: await r.create('admin-workplace-tier-attribute-save', [
        { attributeName: name('WP Tier') },
      ]),
    }),
  },
  // ---- Work Place Setup: variables ---------------------------------------------------------
  {
    endpointId: 'admin-workplace-tier-variable-save',
    request: async (r) => [
      wpVarBody(
        await r.create('admin-workplace-tier-attribute-save', [{ attributeName: name('WP Tier') }]),
      ),
    ],
    createsWith: 'admin-workplace-tier-variable-delete',
  },
  {
    endpointId: 'admin-workplace-tier-variable-update',
    request: async (r) => {
      const tier = await r.create('admin-workplace-tier-attribute-save', [
        { attributeName: name('WP Tier') },
      ]);
      const id = await r.create('admin-workplace-tier-variable-save', [wpVarBody(tier)]);
      return { ...wpVarBody(tier, 'WP Var edited'), id };
    },
  },
  {
    endpointId: 'admin-workplace-tier-variable-delete',
    request: async (r) => {
      const tier = await r.create('admin-workplace-tier-attribute-save', [
        { attributeName: name('WP Tier') },
      ]);
      return { id: await r.create('admin-workplace-tier-variable-save', [wpVarBody(tier)]) };
    },
  },
  {
    endpointId: 'admin-workplace-tier-variable-reporting-hierarchy',
    request: async (r) => {
      const tier = await r.create('admin-workplace-tier-attribute-save', [
        { attributeName: name('WP Tier') },
      ]);
      return { id: await r.create('admin-workplace-tier-variable-save', [wpVarBody(tier)]) };
    },
  },
  {
    endpointId: 'admin-workplace-hierarchy',
    request: async (r) => ({
      parentAttributeId: await r.create('admin-workplace-tier-attribute-save', [
        { attributeName: name('WP Tier') },
      ]),
      parentVariableId: '0',
    }),
  },
  // ---- Work Place Location Setup -----------------------------------------------------------
  {
    endpointId: 'admin-workplace-location-save',
    request: async (r) => {
      const tier = await r.create('admin-workplace-tier-attribute-save', [
        { attributeName: name('WP Tier') },
      ]);
      const v = await r.create('admin-workplace-tier-variable-save', [wpVarBody(tier)]);
      return [locationBody(tier, v)];
    },
    createsWith: 'admin-workplace-location-delete',
  },
  ...(
    [
      'admin-workplace-location-update',
      'admin-workplace-location-delete',
      'admin-workplace-location-by-id',
      'admin-workplace-location-get',
    ] as const
  ).map((endpointId): Case => ({
    endpointId,
    request: async (r) => {
      const tier = await r.create('admin-workplace-tier-attribute-save', [
        { attributeName: name('WP Tier') },
      ]);
      const v = await r.create('admin-workplace-tier-variable-save', [wpVarBody(tier)]);
      const id = await r.create('admin-workplace-location-save', [locationBody(tier, v)]);
      if (endpointId === 'admin-workplace-location-update')
        return { ...locationBody(tier, v, 'Location edited'), id };
      if (endpointId === 'admin-workplace-location-get')
        return { attributeId: tier, variableId: v };
      return { id };
    },
  })),
  // ---- HR Breakdown Setup ----------------------------------------------------------------
  {
    endpointId: 'admin-hr-tier-attribute-save',
    request: () => Promise.resolve([{ attributeName: name('HR Tier') }]),
    createsWith: 'admin-hr-tier-attribute-delete',
  },
  {
    endpointId: 'admin-hr-tier-attribute-update',
    request: async (r) => ({
      id: await r.create('admin-hr-tier-attribute-save', [{ attributeName: name('HR Tier') }]),
      attributeName: name('HR Tier edited'),
    }),
  },
  {
    endpointId: 'admin-hr-tier-attribute-delete',
    request: async (r) => ({
      id: await r.create('admin-hr-tier-attribute-save', [{ attributeName: name('HR Tier') }]),
    }),
  },
  {
    endpointId: 'admin-hr-tier-variable-save',
    request: async (r) => [
      hrVarBody(
        await r.create('admin-hr-tier-attribute-save', [{ attributeName: name('HR Tier') }]),
      ),
    ],
    createsWith: 'admin-hr-tier-variable-delete',
  },
  {
    endpointId: 'admin-hr-tier-variable-update',
    request: async (r) => {
      const tier = await r.create('admin-hr-tier-attribute-save', [
        { attributeName: name('HR Tier') },
      ]);
      const id = await r.create('admin-hr-tier-variable-save', [hrVarBody(tier)]);
      return { ...hrVarBody(tier, 'HR Var edited'), id };
    },
  },
  {
    endpointId: 'admin-hr-tier-variable-delete',
    request: async (r) => {
      const tier = await r.create('admin-hr-tier-attribute-save', [
        { attributeName: name('HR Tier') },
      ]);
      return { id: await r.create('admin-hr-tier-variable-save', [hrVarBody(tier)]) };
    },
  },
  {
    endpointId: 'admin-hr-tier-variable-reporting-hierarchy',
    request: async (r) => {
      const tier = await r.create('admin-hr-tier-attribute-save', [
        { attributeName: name('HR Tier') },
      ]);
      return { id: await r.create('admin-hr-tier-variable-save', [hrVarBody(tier)]) };
    },
  },
  // ---- Employee Data -----------------------------------------------------------------------
  {
    endpointId: 'admin-employee-save',
    request: () => Promise.resolve(employeeBody('Save')),
    createsWith: 'admin-employee-delete',
  },
  {
    endpointId: 'admin-employee-update',
    request: async (r) => {
      const id = await r.create('admin-employee-save', employeeBody('Edit'));
      return { ...employeeBody('Edited'), id };
    },
  },
  {
    endpointId: 'admin-employee-delete',
    request: async (r) => ({ id: await r.create('admin-employee-save', employeeBody('Remove')) }),
  },
  // ---- Role postings: the read keyed by an employee (writes stay gated — see the header) -----
  {
    endpointId: 'admin-role-posting-by-company-and-employee',
    request: async (r) => ({
      employeeId: await r.create('admin-employee-save', employeeBody('Posting')),
    }),
  },
];

test.describe('Admin · the engine on every endpoint it cannot reach alone @api @admin-api', () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(
    process.env.ADMIN_LIFECYCLE !== 'true',
    'writes to the QA company; set ADMIN_LIFECYCLE=true',
  );
  test.skip(
    !businessM || testData.businessMKpostId.includes('qa.business.m'),
    'needs the BUSINESS_M account of the QA testing company (QA_BUSINESS_M_KPOST_ID)',
  );

  for (const c of CASES) {
    const label = apiRegistry.get(c.endpointId);

    test(`${label.method} ${label.path} [${c.endpointId}] › engine on a real record`, async ({
      endpoints,
      validationEngine,
    }) => {
      expect(String(testData.businessMCompanyId), 'only ever the QA testing company (242)').toBe(
        '242',
      );
      const records = new Records(endpoints);
      try {
        const payload = await c.request(records);
        const primary = await engineOn(validationEngine, c.endpointId, payload);
        const created = c.createsWith ? idIn(primary) : undefined;
        if (created) records.track(c.createsWith!, created);
      } finally {
        await records.cleanUp();
      }
    });
  }
});
