import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import { isSqlClient } from '@database/database-client';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { boundaryInFlow, negativeInFlow } from '@engine/flow-negative';
import { expect, test } from '@fixtures';
import { expectStored } from '../../../support/db-stored';
import { firstAttemptOriginal, restoreStep } from '../../../support/flow-restore';

/**
 * Settings › Business Settings (the company admin's own company): Company Details and Bank Details.
 * updateCompanyDetails rewrites the whole company row, so the flow reads it, saves a changed PAN /
 * GST, reads it back, then saves the original values again and checks they are back exactly.
 * Bank details cannot be put back through the API (there is no remove, and blank fields would show
 * as a saved empty account), so that half needs DB_ALLOW_WRITES to restore the column and skips
 * otherwise. Company 242 (QA_BUSINESS_M) only, on the QA server (GLOBAL_LIFECYCLE + TEST_DB_MODE).
 */
const ADMIN: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'business-m')!;
const companyID = String(testData.businessMCompanyId);

interface CompanyRow {
  companyName?: string | null;
  address1?: string | null;
  address2?: string | null;
  panNumber?: string | null;
  gstNumber?: string | null;
}

async function readCompany(endpoints: EndpointExecutor, label: string): Promise<CompanyRow> {
  const read = await endpoints.sendTo(
    'admin-bank-and-company-details',
    { pathParams: { companyID } },
    { label: `company-details:${label}`, auth: { principal: ADMIN }, allowLiveRead: true },
  );
  expect(read.status, `getBankAndCompanyDetails answers (${label})`).toBe(200);
  const body = JSON.parse(read.bodyText ?? '{}') as { data?: { companyDetails?: CompanyRow[] } };
  return body.data?.companyDetails?.[0] ?? {};
}

const save = (endpoints: EndpointExecutor, row: CompanyRow, label: string) =>
  endpoints.sendTo(
    'admin-update-company-details',
    {
      body: {
        companyName: row.companyName ?? null,
        address1: row.address1 ?? null,
        address2: row.address2 ?? null,
        panNumber: row.panNumber ?? null,
        gstNumber: row.gstNumber ?? null,
      },
    },
    {
      label: `company-details:${label}`,
      auth: { principal: ADMIN },
      allowGlobalLifecycle: true,
    },
  );

test.describe('KPost Admin · Business Settings company and bank details @api @admin', () => {
  test.skip(
    process.env.GLOBAL_LIFECYCLE !== 'true' || process.env.TEST_DB_MODE !== 'true',
    'rewrites the QA company’s details and puts them back; set GLOBAL_LIFECYCLE=true and TEST_DB_MODE=true',
  );

  test('Company Details: a new PAN and GST are saved and read back, then the original is restored', async ({
    endpoints,
    databases,
  }) => {
    // Kept from the first attempt: a retry must not take a half-restored row for the original.
    const original = await firstAttemptOriginal('company-242-details', () =>
      readCompany(endpoints, 'before'),
    );
    expect(original.companyName, 'the company has a name to keep (setup)').toBeTruthy();
    const changed: CompanyRow = {
      ...original,
      panNumber: 'QABEN1234Q',
      gstNumber: '33QABEN1234Q1Z5',
    };
    let written = false;
    try {
      const saved = await save(endpoints, changed, 'save');
      written = saved.status < 500;
      expect(saved.status, 'updateCompanyDetails accepts the admin’s change').toBe(200);
      // AdminRegistrationRepository.java:18-21 rewrites company_name, address1/2, pan_card and
      // gst_number on the caller's own registration row (kpost_id from the token).
      await expectStored(
        databases.for('kpost-api'),
        'admin-update-company-details',
        {
          table: 'TBL_KPOST_ADMIN_REGISTRATION',
          where: { kpost_id: ADMIN.username },
          columns: {
            company_name: changed.companyName ?? null,
            address1: changed.address1 ?? null,
            address2: changed.address2 ?? null,
            pan_card: changed.panNumber,
            gst_number: changed.gstNumber,
          },
          rule: 'updateCompanyDetails stores the sent company name, address, PAN and GST on the admin’s company row',
        },
        endpoints,
      );
      const after = await readCompany(endpoints, 'after-save');
      expect.soft(after.panNumber, 'the new PAN is stored').toBe(changed.panNumber);
      expect.soft(after.gstNumber, 'the new GST number is stored').toBe(changed.gstNumber);
      expect.soft(after.companyName, 'the company name is kept').toBe(original.companyName);

      // Bad input on the company's details, by this flow (never the engine); the finally below puts
      // the original back whatever a lenient answer stored.
      await negativeInFlow(
        endpoints,
        'admin-update-company-details',
        {
          body: {
            companyName: changed.companyName ?? null,
            address1: changed.address1 ?? null,
            address2: changed.address2 ?? null,
            panNumber: changed.panNumber,
            gstNumber: changed.gstNumber,
          },
        },
        { label: 'company-details', auth: { principal: ADMIN }, allowGlobalLifecycle: true },
      );
      await boundaryInFlow(
        endpoints,
        'admin-update-company-details',
        {
          body: {
            companyName: changed.companyName ?? null,
            address1: changed.address1 ?? null,
            address2: changed.address2 ?? null,
            panNumber: changed.panNumber,
            gstNumber: changed.gstNumber,
          },
        },
        { label: 'company-details', auth: { principal: ADMIN }, allowGlobalLifecycle: true },
      );
    } finally {
      if (written) {
        const restored = await restoreStep(endpoints, ADMIN, () =>
          save(endpoints, original, 'restore'),
        );
        expect.soft(restored.status, 'the original company details are saved back').toBe(200);
        const back = await readCompany(endpoints, 'after-restore');
        for (const key of [
          'companyName',
          'address1',
          'address2',
          'panNumber',
          'gstNumber',
        ] as const) {
          expect
            .soft(back[key] ?? null, `${key} is back to its original value`)
            .toBe(original[key] ?? null);
        }
      }
    }
  });

  test('Bank Details: an account is saved and read back, then the column is restored', async ({
    endpoints,
    databases,
  }) => {
    const db = databases.for('kpost-api');
    test.skip(
      !isSqlClient(db) || !db.writable,
      'needs provisioned DB_ALLOW_WRITES=true: the API cannot remove saved bank details, so the column is restored in the QA DB',
    );
    const row = await db.findOne<{ kpost_id: string; bank_details: string | null }>({
      table: 'TBL_KPOST_ADMIN_REGISTRATION',
      where: { kpost_id: ADMIN.username },
    });
    expect(row, 'the company admin has a registration row (setup)').toBeTruthy();
    const bank = {
      accountNumber: '000111222333',
      accountHolderName: 'QA Bench',
      ifscCode: 'QABN0000001',
      bankName: 'QA Bench Bank',
      branch: 'QA Branch',
    };
    try {
      const saved = await endpoints.sendTo(
        'admin-update-bank-account',
        { body: bank },
        {
          label: 'company-details:bank-save',
          auth: { principal: ADMIN },
          allowGlobalLifecycle: true,
          // Made up by this flow (no real account), so the QA-identifier guard may let them through.
          ownedIdentifiers: [bank.accountNumber, bank.accountHolderName],
        },
      );
      expect(saved.status, 'updateBankAccountDetails accepts the admin’s account').toBe(200);
      // SignUpLoginServiceImpl.java:1713-1720 writes the five fields as JSON into bank_details on the
      // caller's registration row (AdminRegistrationRepository.java:14). MySQL reorders JSON keys, so
      // the fields are compared, not the text.
      await expectStored(
        db,
        'admin-update-bank-account',
        {
          table: 'TBL_KPOST_ADMIN_REGISTRATION',
          where: { kpost_id: ADMIN.username },
          columns: {
            bank_details: (v: unknown) => {
              const raw = Buffer.isBuffer(v) ? v.toString('utf8') : v;
              let stored: Record<string, unknown>;
              try {
                stored = (typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})) as Record<
                  string,
                  unknown
                >;
              } catch {
                return false;
              }
              return Object.entries(bank).every(([k, want]) => stored[k] === want);
            },
          },
          rule: 'updateBankAccountDetails stores the sent account number, holder, IFSC, bank and branch in bank_details',
        },
        endpoints,
      );
      const read = await endpoints.sendTo(
        'admin-bank-and-company-details',
        { pathParams: { companyID } },
        { label: 'company-details:bank-read', auth: { principal: ADMIN }, allowLiveRead: true },
      );
      expect.soft(read.bodyText ?? '', 'the saved account is read back').toContain(bank.ifscCode);

      // Bad input on the bank details, by this flow; the column is restored in the finally below.
      await negativeInFlow(
        endpoints,
        'admin-update-bank-account',
        { body: bank },
        {
          label: 'company-details:bank',
          auth: { principal: ADMIN },
          allowGlobalLifecycle: true,
          ownedIdentifiers: [bank.accountNumber, bank.accountHolderName],
        },
      );
      await boundaryInFlow(
        endpoints,
        'admin-update-bank-account',
        { body: bank },
        {
          label: 'company-details:bank',
          auth: { principal: ADMIN },
          allowGlobalLifecycle: true,
          ownedIdentifiers: [bank.accountNumber, bank.accountHolderName],
        },
      );
    } finally {
      if (isSqlClient(db)) {
        await db.query(
          'UPDATE TBL_KPOST_ADMIN_REGISTRATION SET bank_details = ? WHERE kpost_id = ?',
          [row!.bank_details, ADMIN.username],
        );
      }
    }
  });
});
