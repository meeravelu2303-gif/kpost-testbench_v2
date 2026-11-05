import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { isProvided, testData } from '@config/test-data.config';
import { thresholds } from '@config/thresholds.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { apiRegistry } from '@api/definitions/index';
import { isPlainObject } from '@utils/json';
import { expect, test } from '@fixtures';
import { employeePayload } from '../support/screen-payloads';
import { retryOrSkip } from '../../support/live-condition';

/**
 * Response times of all 38 Admin endpoints from repeated sequential calls (per-request latency, not
 * load). Each endpoint's p95 is held to its method's bench budget (thresholds.config.ts). Every record
 * is created by the test and deleted again; role posting runs on the QA company only.
 */
const businessM: Principal | undefined = AUTH_PROFILES.kpost.principals.find(
  (p) => p.key === 'business-m',
);
const stamp = Date.now();
const name = (label: string): string => `QA LAT ${label} ${stamp}`;
const READ_SAMPLES = 10;
const WRITE_CYCLES = 5;
// More cycles on demand (e.g. to confirm a spike): LATENCY_ROLE_CYCLES=5.
const ROLE_CYCLES = Number(process.env.LATENCY_ROLE_CYCLES ?? 3);

type Json = Record<string, unknown>;
interface Reply {
  status: number;
  text: string;
  value: unknown;
  id?: string;
}

class Timer {
  readonly samples = new Map<string, number[]>();
  /** The slowest call per key, with its exact request body, so a filed bug's curl carries real data. */
  private readonly slowest = new Map<string, { ms: number; body: string }>();
  constructor(private readonly endpoints: EndpointExecutor) {}

  /** `key` separates actions that share one endpoint (suspend / revoke / terminate); defaults to the id. */
  async call(
    id: string,
    body: unknown,
    minted: readonly (string | number)[] = [],
    key = id,
  ): Promise<Reply> {
    const spec =
      apiRegistry.get(id).method === 'GET'
        ? { pathParams: body as Record<string, string | number> }
        : { body };
    const ex = await this.endpoints.sendTo(id, spec, {
      label: `latency:${id}`,
      auth: { principal: businessM! },
      allowLiveWrite: true,
      allowLiveRead: true,
      ownedIdentifiers: minted,
      timeoutMs: 60_000,
    });
    // A transport failure has no meaningful duration; only answered calls are timed.
    if (ex.status > 0) {
      const list = this.samples.get(key) ?? [];
      list.push(ex.durationMs);
      if (ex.durationMs > (this.slowest.get(key)?.ms ?? -1))
        this.slowest.set(key, { ms: ex.durationMs, body: JSON.stringify(body) });
      this.samples.set(key, list);
    }
    const text = ex.bodyText ?? '';
    let value: unknown;
    try {
      const parsed: unknown = JSON.parse(text);
      value = isPlainObject(parsed) ? parsed.value : undefined;
    } catch {
      value = undefined;
    }
    const rec: unknown = Array.isArray(value) ? value[0] : value;
    const rid = isPlainObject(rec) && typeof rec.id === 'string' ? rec.id : undefined;
    return { status: ex.status, text, value, id: rid };
  }

  /** p50/p95/max per endpoint, each p95 held to its method's budget (soft: every endpoint is reported). */
  report(): void {
    const pct = (sorted: number[], p: number): number =>
      sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
    const rows: Array<Record<string, unknown>> = [];
    for (const [id, list] of [...this.samples.entries()].sort()) {
      const sorted = [...list].sort((a, b) => a - b);
      const method = apiRegistry.get(id.split(' ')[0] ?? id).method;
      const budget =
        thresholds.responseTime.maxMsByMethod[method] ?? thresholds.responseTime.defaultMaxMs;
      const row = {
        id,
        method,
        n: sorted.length,
        p50: pct(sorted, 0.5),
        p95: pct(sorted, 0.95),
        max: sorted.at(-1),
        budget,
      };
      rows.push({ ...row, slowestRequest: this.slowest.get(id)?.body });
      test.info().annotations.push({
        type: 'latency',
        description: `${id} ${method} n=${row.n} p50=${row.p50}ms p95=${row.p95}ms max=${row.max}ms budget=${budget}ms`,
      });
      expect
        .soft(row.p95, `${id}: p95 within the ${budget} ms budget (p50 ${row.p50} ms, n=${row.n})`)
        .toBeLessThanOrEqual(budget);
    }
    void test.info().attach('latency.json', {
      body: JSON.stringify(rows, null, 1),
      contentType: 'application/json',
    });
  }
}

const tier = (label: string): Json[] => [{ attributeName: name(label) }];
const variable = (attributeId: string, label: string): Json => ({
  variableName: name(label),
  attributeId,
  parentVariableId: 0,
  parentAttributeId: 0,
  reportingJson: '[]',
});
const location = (attributeId: string, variableId: string, label: string): Json => ({
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
const employee = (label: string): Json => employeePayload(`Lat ${label} ${stamp}`);

test.describe('Admin · response times of all 38 endpoints @api @admin-api @performance', () => {
  test.describe.configure({ timeout: 600_000 });
  test.skip(
    process.env.ADMIN_LIFECYCLE !== 'true',
    'writes to the QA company; set ADMIN_LIFECYCLE=true',
  );
  test.skip(
    !businessM || testData.businessMKpostId.includes('qa.business.m'),
    'needs the BUSINESS_M account of the QA testing company (QA_BUSINESS_M_KPOST_ID)',
  );

  test('reads, record reads, and save → update → delete cycles stay within budget', async ({
    endpoints,
  }) => {
    expect(String(testData.businessMCompanyId), 'only ever the QA testing company (242)').toBe(
      '242',
    );
    const t = new Timer(endpoints);
    const made: Array<[string, string]> = [];
    const make = async (saveId: string, body: unknown): Promise<string> => {
      const r = await t.call(saveId, body);
      expect(r.id, `setup: ${saveId} (HTTP ${r.status} ${r.text.slice(0, 120)})`).toBeTruthy();
      made.push([saveId.replace(/-save$/, '-delete'), r.id!]);
      return r.id!;
    };
    try {
      // 1. Company-wide reads.
      const reads: Array<[string, unknown]> = [
        ['admin-employee-details', {}],
        ['admin-hr-tier-attribute-by-company', {}],
        ['admin-hr-tier-variable-list', { parentVariableId: 0 }],
        ['admin-role-posting-by-company', {}],
        ['admin-role-posting-employees', {}],
        ['admin-role-posting-suspended-list', { requestType: 'suspend' }],
        ['admin-workplace-tier-attribute-by-company', {}],
        ['admin-workplace-tier-variable-list', { parentVariableId: 0 }],
        ['admin-workplace-location-all', {}],
        ['admin-country-address-by-pincode', { pincode: testData.pinCode, country: 'India' }],
      ];
      for (const [id, body] of reads) for (let i = 0; i < READ_SAMPLES; i++) await t.call(id, body);

      // 2. Reads keyed by a record the test owns.
      const wpAttr = await make('admin-workplace-tier-attribute-save', tier('WP Tier'));
      const wpVar = await make('admin-workplace-tier-variable-save', [variable(wpAttr, 'WP Var')]);
      const loc = await make('admin-workplace-location-save', [
        location(wpAttr, wpVar, 'Location'),
      ]);
      const hrAttr = await make('admin-hr-tier-attribute-save', tier('HR Tier'));
      const hrVar = await make('admin-hr-tier-variable-save', [variable(hrAttr, 'HR Var')]);
      const emp = await make('admin-employee-save', employee('Read'));
      const keyed: Array<[string, unknown]> = [
        ['admin-workplace-location-by-id', { id: loc }],
        ['admin-workplace-location-get', { attributeId: wpAttr, variableId: wpVar }],
        ['admin-workplace-tier-variable-reporting-hierarchy', { id: wpVar }],
        ['admin-hr-tier-variable-reporting-hierarchy', { id: hrVar }],
        ['admin-workplace-hierarchy', { parentAttributeId: wpAttr, parentVariableId: '0' }],
        ['admin-role-posting-by-company-and-employee', { employeeId: emp }],
      ];
      for (const [id, body] of keyed) for (let i = 0; i < READ_SAMPLES; i++) await t.call(id, body);

      // 3. save → update → delete cycles.
      for (let i = 0; i < WRITE_CYCLES; i++) {
        const cycle = async (
          save: string,
          update: string,
          remove: string,
          body: Json,
          edited: Json,
          arraySave = true,
        ) => {
          const r = await t.call(save, arraySave ? [body] : body);
          if (!r.id) return;
          await t.call(update, { ...edited, id: r.id });
          await t.call(remove, { id: r.id });
        };
        await cycle(
          'admin-workplace-tier-attribute-save',
          'admin-workplace-tier-attribute-update',
          'admin-workplace-tier-attribute-delete',
          tier(`WP T${i}`)[0]!,
          tier(`WP T${i} edited`)[0]!,
        );
        await cycle(
          'admin-hr-tier-attribute-save',
          'admin-hr-tier-attribute-update',
          'admin-hr-tier-attribute-delete',
          tier(`HR T${i}`)[0]!,
          tier(`HR T${i} edited`)[0]!,
        );
        await cycle(
          'admin-workplace-tier-variable-save',
          'admin-workplace-tier-variable-update',
          'admin-workplace-tier-variable-delete',
          variable(wpAttr, `WP V${i}`),
          variable(wpAttr, `WP V${i} edited`),
        );
        await cycle(
          'admin-hr-tier-variable-save',
          'admin-hr-tier-variable-update',
          'admin-hr-tier-variable-delete',
          variable(hrAttr, `HR V${i}`),
          variable(hrAttr, `HR V${i} edited`),
        );
        await cycle(
          'admin-workplace-location-save',
          'admin-workplace-location-update',
          'admin-workplace-location-delete',
          location(wpAttr, wpVar, `L${i}`),
          location(wpAttr, wpVar, `L${i} edited`),
        );
        await cycle(
          'admin-employee-save',
          'admin-employee-update',
          'admin-employee-delete',
          employee(`C${i}`),
          employee(`C${i} edited`),
          false,
        );
      }
    } finally {
      for (const [deleteId, id] of made.reverse())
        await t.call(deleteId, { id }).catch(() => undefined);
      t.report();
    }
  });

  test('role posting: save → assign → suspend → revoke → terminate → delete stay within budget', async ({
    endpoints,
  }) => {
    test.skip(
      process.env.ADMIN_ROLE_POSTING_LIVE !== 'true' ||
        !isProvided('roleEmployeeMobile') ||
        !isProvided('roleEmployeeEmail'),
      'needs ADMIN_ROLE_POSTING_LIVE=true and the reserved QA employee identity (QA_ROLE_EMPLOYEE_MOBILE/EMAIL)',
    );
    expect(String(testData.businessMCompanyId), 'only ever the QA testing company (242)').toBe(
      '242',
    );
    const t = new Timer(endpoints);
    const made: Array<[string, string]> = [];
    const make = async (saveId: string, body: unknown): Promise<string> => {
      const r = await t.call(saveId, body);
      expect(r.id, `setup: ${saveId} (HTTP ${r.status} ${r.text.slice(0, 120)})`).toBeTruthy();
      made.push([saveId.replace(/-save$/, '-delete'), r.id!]);
      return r.id!;
    };
    const live = new Set<string>(); // postings still present
    const assigned = new Map<string, Json>(); // posting id → minted ids, while an employee is assigned
    try {
      const me = await endpoints.sendTo(
        'signup-login-fetch-user-details',
        { body: { kpostID: testData.businessMKpostId, countryID: testData.countryId } },
        { label: 'latency:company-name', auth: { principal: businessM! }, allowLiveRead: true },
      );
      const companyName = /"companyName"\s*:\s*"([^"]+)"/.exec(me.bodyText ?? '')?.[1] ?? '';
      retryOrSkip(!companyName, 'the QA company name could not be read right now; not invented');

      const wpAttr = await make('admin-workplace-tier-attribute-save', tier('RP WP Tier'));
      const wpVar = await make('admin-workplace-tier-variable-save', [
        variable(wpAttr, 'RP WP Var'),
      ]);
      const loc = await make('admin-workplace-location-save', [
        location(wpAttr, wpVar, 'RP Location'),
      ]);
      const hrAttr = await make('admin-hr-tier-attribute-save', tier('RP HR Tier'));
      const emp = await make('admin-employee-save', employee('RP'));
      const today = new Date().toISOString().slice(0, 10);

      for (let i = 0; i < ROLE_CYCLES; i++) {
        const designation = name(`RP Role ${i}`);
        const hrVar = await make('admin-hr-tier-variable-save', [
          { ...variable(hrAttr, `RP Role ${i}`), variableName: designation },
        ]);
        await t.call('admin-role-posting-save', [
          {
            companyName,
            userType: 'BUSINESS_M',
            countryId: 1,
            countryCode: 91,
            lastworkplaceTierId: wpAttr,
            lastWorkplaceVariableId: wpVar,
            workplaceJson: JSON.stringify([
              {
                attributeId: wpAttr,
                variableId: wpVar,
                label: name('RP WP Var'),
                code: '',
                abbreviation: '',
              },
            ]),
            workplaceLocationId: [loc],
            lastHrTierId: hrAttr,
            lastHrVariableId: hrVar,
            hrJson: JSON.stringify([
              {
                parentAttributeId: hrAttr,
                variableId: hrVar,
                parentVariableName: designation,
                code: '',
                abbreviation: '',
              },
            ]),
            reportingWorkplaceJson: JSON.stringify([
              { workplaceLocationId: '', variableName: ['-'], locationName: '-' },
            ]),
            reportingHrJson: JSON.stringify([
              { variableId: '', variableName: '-', attributeId: hrAttr },
            ]),
            requestType: 'allocate',
            displayName: `QA ${designation}`.toUpperCase(),
            ksmaccDisplayName: designation.toUpperCase(),
          },
        ]);
        const list = await t.call('admin-role-posting-by-company', {});
        const posting = ((Array.isArray(list.value) ? list.value : []) as Json[]).find(
          (r) => r.lastHrVariableId === hrVar,
        );
        expect(posting?.id, `cycle ${i}: the saved posting is listed`).toBeTruthy();
        if (!posting) continue;
        const pid = String(posting.id);
        live.add(pid);
        const minted = ['kpostID', 'ksmaccID', 'ksmaccCompanyID']
          .map((k) => posting[k])
          .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number');

        const assign = await t.call(
          'admin-role-posting-update',
          {
            companyId: '242',
            ...posting,
            employeeId: emp,
            userType: 'BUSINESS_M',
            companyName,
            requestType: 'reallocate',
          },
          minted,
        );
        if (assign.status !== 200) continue;
        assigned.set(pid, { minted, posting });
        const act = (requestType: string, extra: Json) =>
          t.call(
            'admin-role-posting-suspend-terminate',
            {
              rolePostingId: pid,
              employeeId: emp,
              requestType,
              reason: 'QA latency',
              remarks: `QA latency ${requestType}`,
              kpostID: posting.kpostID,
              ksmaccID: posting.ksmaccID,
              ...extra,
            },
            minted,
            `admin-role-posting-suspend-terminate ${requestType}`,
          );
        await act('suspend', {
          duration: JSON.stringify({ suspensionFrom: today, suspensionTo: today }),
        });
        await act('revoked', { rejoiningDate: Date.now() });
        const term = await act('terminate', {
          duration: JSON.stringify({ dateOfTermination: today, name: 'QA latency' }),
        });
        if (term.status === 200) assigned.delete(pid);
        const del = await t.call('admin-role-posting-delete', { id: pid });
        if (del.status === 200) live.delete(pid);
      }
    } finally {
      for (const [pid, { minted }] of assigned)
        await endpoints
          .sendTo(
            'admin-role-posting-suspend-terminate',
            {
              body: {
                rolePostingId: pid,
                employeeId: made.find(([d]) => d === 'admin-employee-delete')?.[1],
                requestType: 'terminate',
                reason: 'QA cleanup',
                remarks: 'QA cleanup',
                duration: JSON.stringify({
                  dateOfTermination: new Date().toISOString().slice(0, 10),
                  name: 'QA cleanup',
                }),
              },
            },
            {
              label: 'latency:cleanup-terminate',
              auth: { principal: businessM! },
              allowLiveWrite: true,
              ownedIdentifiers: minted as Array<string | number>,
              timeoutMs: 60_000,
            },
          )
          .catch(() => undefined);
      for (const pid of live)
        await endpoints
          .sendTo(
            'admin-role-posting-delete',
            { body: { id: pid } },
            {
              label: 'latency:cleanup-posting',
              auth: { principal: businessM! },
              allowLiveWrite: true,
            },
          )
          .catch(() => undefined);
      // Parent records only once every posting is gone (a posting pointing at deleted records breaks the list).
      if (live.size === 0)
        for (const [deleteId, id] of made.reverse())
          await endpoints
            .sendTo(
              deleteId,
              { body: { id } },
              { label: 'latency:cleanup', auth: { principal: businessM! }, allowLiveWrite: true },
            )
            .catch(() => undefined);
      t.report();
    }
  });
});
