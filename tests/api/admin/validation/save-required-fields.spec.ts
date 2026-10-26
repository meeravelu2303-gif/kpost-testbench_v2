import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { isPlainObject } from '@utils/json';
import { expect, test } from '@fixtures';

/**
 * Server-side required fields on the two saves that lack them (found 2026-10-26, reproduced 2/2 alone).
 *
 *  - POST /location/save checks only locationName. The Workplace Location screen refuses a row without a
 *    6-digit pincode, state, city and area (WorkPlaceLocationSetup.js:1232) and always sends the selected
 *    level (attributeId + variableId).
 *  - POST /hrSetUpTierVariable/save checks only variableName. Its twin /adminTierVariable/save rejects a
 *    missing attributeId or parentVariableId ("... is required"); a parentless HR variable cannot be listed
 *    (the list answers 400 to a null parent) yet blocks deleting its tier ("record is already mapped").
 *
 * Each case logs the exact request and response (annotations) and deletes what it created. QA company only.
 */
const businessM: Principal | undefined = AUTH_PROFILES.kpost.principals.find(
  (p) => p.key === 'business-m',
);
const stamp = Date.now();
const name = (label: string): string => `QA REQ ${label} ${stamp}`;

interface Sent {
  status: number;
  text: string;
  id?: string;
}

async function send(
  endpoints: EndpointExecutor,
  id: string,
  body: unknown,
  label: string,
): Promise<Sent> {
  const ex = await endpoints.sendTo(
    id,
    { body },
    { label: `required:${label}`, auth: { principal: businessM! }, allowLiveWrite: true },
  );
  const text = ex.bodyText ?? '';
  test
    .info()
    .annotations.push(
      { type: `request ${label}`, description: `POST ${id} ${JSON.stringify(body)}` },
      { type: `response ${label}`, description: `HTTP ${ex.status} ${text.slice(0, 400)}` },
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const value = isPlainObject(parsed) ? parsed.value : undefined;
  const rec: unknown = Array.isArray(value) ? value[0] : value;
  return {
    status: ex.status,
    text,
    id: isPlainObject(rec) && typeof rec.id === 'string' ? rec.id : undefined,
  };
}

test.describe('Admin · saves enforce the fields their screens require @api @admin-api', () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(
    process.env.ADMIN_LIFECYCLE !== 'true',
    'writes to the QA company; set ADMIN_LIFECYCLE=true',
  );
  test.skip(
    !businessM || testData.businessMKpostId.includes('qa.business.m'),
    'needs the BUSINESS_M account of the QA testing company (QA_BUSINESS_M_KPOST_ID)',
  );

  test('location save and HR variable save reject records missing a required field', async ({
    endpoints,
  }) => {
    expect(String(testData.businessMCompanyId), 'only ever the QA testing company (242)').toBe(
      '242',
    );
    const cleanup: Array<[string, string]> = []; // [delete endpoint, id], deleted last-in first-out
    try {
      const wpAttr = await send(
        endpoints,
        'admin-workplace-tier-attribute-save',
        [{ attributeName: name('WP Tier') }],
        'wp-attr',
      );
      if (wpAttr.id) cleanup.push(['admin-workplace-tier-attribute-delete', wpAttr.id]);
      const wpVar = await send(
        endpoints,
        'admin-workplace-tier-variable-save',
        [
          {
            variableName: name('WP Var'),
            attributeId: wpAttr.id,
            parentVariableId: 0,
            parentAttributeId: 0,
            reportingJson: '[]',
          },
        ],
        'wp-var',
      );
      if (wpVar.id) cleanup.push(['admin-workplace-tier-variable-delete', wpVar.id]);
      const hrAttr = await send(
        endpoints,
        'admin-hr-tier-attribute-save',
        [{ attributeName: name('HR Tier') }],
        'hr-attr',
      );
      if (hrAttr.id) cleanup.push(['admin-hr-tier-attribute-delete', hrAttr.id]);
      expect(wpAttr.id && wpVar.id && hrAttr.id, 'setup records created').toBeTruthy();

      // The screen's own row, then the same row with one field the screen requires left out.
      const location = {
        attributeId: wpAttr.id,
        variableId: wpVar.id,
        locationName: name('Location'),
        reportingWorkplaceLocation: '[{"variableId":"0","workplaceLocationId":"0"}]',
        reportingWorkplaceLocationId: '0',
        pincode: testData.pinCode,
        countryName: 'India',
        countryId: 1,
      };
      const hrVar = {
        variableName: name('HR Var'),
        attributeId: hrAttr.id,
        parentVariableId: 0,
        parentAttributeId: 0,
        reportingJson: '[]',
      };
      const cases: Array<
        [endpoint: string, deleteId: string, body: Record<string, unknown>, missing: string]
      > = [
        ['admin-workplace-location-save', 'admin-workplace-location-delete', location, 'pincode'],
        [
          'admin-workplace-location-save',
          'admin-workplace-location-delete',
          location,
          'variableId',
        ],
        ['admin-hr-tier-variable-save', 'admin-hr-tier-variable-delete', hrVar, 'attributeId'],
        ['admin-hr-tier-variable-save', 'admin-hr-tier-variable-delete', hrVar, 'parentVariableId'],
      ];
      for (const [endpoint, deleteId, body, missing] of cases) {
        const without = { ...body };
        delete without[missing];
        const r = await send(endpoints, endpoint, [without], `${endpoint}-without-${missing}`);
        if (r.id) cleanup.push([deleteId, r.id]);
        expect
          .soft(r.status, `${endpoint} without ${missing} is refused with a 400, not saved`)
          .toBe(400);
      }

      // The twin of the HR save, for comparison: the workplace variable save refuses the same request.
      const twin = { ...hrVar, variableName: name('WP Var 2'), attributeId: wpAttr.id };
      delete (twin as Record<string, unknown>).parentVariableId;
      const t = await send(
        endpoints,
        'admin-workplace-tier-variable-save',
        [twin],
        'wp-var-without-parentVariableId',
      );
      if (t.id) cleanup.push(['admin-workplace-tier-variable-delete', t.id]);
      test
        .info()
        .annotations.push({ type: 'comparison', description: `workplace twin: HTTP ${t.status}` });
    } finally {
      const left: string[] = [];
      for (const [deleteId, id] of cleanup.reverse()) {
        const del = await send(endpoints, deleteId, { id }, `cleanup-${deleteId}`);
        if (del.status !== 200) left.push(`${deleteId} ${id}: HTTP ${del.status}`);
      }
      expect.soft(left, 'every record this test created is deleted again').toEqual([]);
    }
  });

  /*
   * Found by the Admin UI run 2026-10-26: the Workplace Location screen leaves "Address Line 2" optional
   * (its check is commented out, WorkPlaceLocationSetup.js:1234) and /location/save accepts it empty, but
   * /location/update then refuses the screen's own edit with 400 "addressLine2 is required". Payloads are
   * the screen's (save :98-120, update :1095-1110), without companyId (taken from the token).
   */
  test('a location saved without address line 2 can be edited', async ({ endpoints }) => {
    expect(String(testData.businessMCompanyId), 'only ever the QA testing company (242)').toBe(
      '242',
    );
    const cleanup: Array<[string, string]> = [];
    try {
      const wpAttr = await send(
        endpoints,
        'admin-workplace-tier-attribute-save',
        [{ attributeName: name('WP Tier') }],
        'wp-attr',
      );
      if (wpAttr.id) cleanup.push(['admin-workplace-tier-attribute-delete', wpAttr.id]);
      const wpVar = await send(
        endpoints,
        'admin-workplace-tier-variable-save',
        [
          {
            variableName: name('WP Var'),
            attributeId: wpAttr.id,
            parentVariableId: 0,
            parentAttributeId: 0,
            reportingJson: '[]',
          },
        ],
        'wp-var',
      );
      if (wpVar.id) cleanup.push(['admin-workplace-tier-variable-delete', wpVar.id]);
      expect(wpAttr.id && wpVar.id, 'setup records created').toBeTruthy();

      const row = {
        attributeId: wpAttr.id,
        variableId: wpVar.id,
        workPlaceLocation: JSON.stringify([
          { attributeId: wpAttr.id, variableId: wpVar.id, variableName: name('WP Var') },
        ]),
        reportingWorkplaceLocation: '[{"variableId":"0","workplaceLocationId":"0"}]',
        reportingWorkplaceLocationId: '0',
        locationName: name('Location'),
        pincode: testData.pinCode,
        state: 'Tamil Nadu',
        city: 'Chennai',
        area: 'Chennai',
        addressLine1: 'QA bench street',
        addressLine2: '',
        countryId: 1,
        countryName: 'India',
      };
      const saved = await send(endpoints, 'admin-workplace-location-save', [row], 'save-location');
      if (saved.id) cleanup.push(['admin-workplace-location-delete', saved.id]);
      expect(saved.status === 200 && saved.id, "the screen's save is accepted").toBeTruthy();

      const updated = await send(
        endpoints,
        'admin-workplace-location-update',
        { ...row, id: saved.id, locationName: `${name('Location')} edited` },
        'update-location',
      );
      expect
        .soft(updated.status, "the screen's edit of that location is accepted, as the save was")
        .toBe(200);
    } finally {
      const left: string[] = [];
      for (const [deleteId, id] of cleanup.reverse()) {
        const del = await send(endpoints, deleteId, { id }, `cleanup-${deleteId}`);
        if (del.status !== 200) left.push(`${deleteId} ${id}: HTTP ${del.status}`);
      }
      expect.soft(left, 'every record this test created is deleted again').toEqual([]);
    }
  });

  /*
   * Same root cause on Employee Data (Admin UI run 2026-10-26): the screen saves an employee with the
   * optional landline empty (accepted), then its own edit — which reloads landline as null and Aadhaar
   * as "" (the backend stores no Aadhaar) — is refused: 400 "landline is required". Bodies are the
   * screen's own, captured from the UI run; only the identity is the reserved QA employee's.
   */
  test("an employee saved on screen can be edited with the screen's own update", async ({
    endpoints,
  }) => {
    expect(String(testData.businessMCompanyId), 'only ever the QA testing company (242)').toBe(
      '242',
    );
    const first = `Qaemp${String(stamp).slice(-6)}`;
    const personal = {
      firstName: first,
      lastName: 'Bench',
      dob: '1990-01-15',
      gender: 'Male',
      maritalStatus: 'Single',
      landline: '',
      mobile: testData.roleEmployeeMobile,
      alternativeMobileNo: '',
      emailAddress: testData.roleEmployeeEmail,
      alternativeEmailAddress: '',
      nationality: 'India',
      disability: false,
      attachment: [],
    };
    const residential = {
      residentialCountry: 'India',
      residentialZipCode: testData.pinCode,
      residentialState: 'Tamil Nadu',
      residentialCity: 'Chennai',
      residentialArea: 'Chennai',
      residentialAddressLine1: 'QA bench street',
      residentialAddressLine2: 'QA bench area',
    };
    const mailing = {
      mailingZipCode: testData.pinCode,
      mailingState: 'Tamil Nadu',
      mailingCity: 'Chennai',
      mailingArea: 'Chennai',
      mailingAddressLine1: 'QA bench street',
      mailingAddressLine2: 'QA bench area',
    };
    const employment = {
      hrJson: '[]',
      reportingHrJson: '[]',
      employmentStatus: 'Self-employed',
      dateOfJoining: new Date().toISOString().slice(0, 10),
    };
    const education = {
      qualification: "Master's Degree (Postgraduate)",
      percentage: '75',
      yearOfGraduation: '2012-05-31',
      attachment: [],
    };
    const workExp = {
      isExperienced: 'No',
      totalExp: '',
      experienceDetails: [{ company: '', jobTitle: '', fromDate: '', toDate: '' }],
    };
    let id: string | undefined;
    try {
      const saved = await send(
        endpoints,
        'admin-employee-save',
        {
          personalInformationObj: personal,
          residentialObj: residential,
          mailingObj: { mailingCountry: 'India', ...mailing },
          employmentObj: employment,
          educationObj: [{ ...education, instituteName: 'QA Institute' }],
          workExpObj: workExp,
          additionalObj: {
            nationality: 'India',
            citizenship: 'India',
            panCard: 'ABCPE1234F',
            aadharcard: '234123412346',
          },
        },
        'save-employee',
      );
      id = saved.id;
      expect(saved.status === 200 && id, "the screen's save is accepted").toBeTruthy();

      // The screen's edit body: last name changed; landline null, institute "" and Aadhaar "" as reloaded.
      const updated = await send(
        endpoints,
        'admin-employee-update',
        {
          id,
          personalInformationObj: {
            ...personal,
            lastName: 'Benchedit',
            landline: null,
            typeOfDisability: null,
          },
          residentialObj: residential,
          mailingObj: mailing,
          employmentObj: employment,
          educationObj: [{ ...education, instituteName: 'QA Institute' }],
          workExpObj: workExp,
          additionalObj: {
            nationality: 'India',
            citizenship: 'India',
            panCard: 'ABCPE1234F',
            aadharcard: '234123412346',
          },
        },
        'update-employee',
      );
      expect
        .soft(updated.status, "the screen's edit of that employee is accepted, as the save was")
        .toBe(200);
    } finally {
      if (id) {
        const del = await send(endpoints, 'admin-employee-delete', { id }, 'cleanup-employee');
        expect.soft(del.status, 'the test employee is deleted again').toBe(200);
      }
    }
  });
});
