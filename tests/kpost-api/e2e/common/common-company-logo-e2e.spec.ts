import { checkOnRealRecord } from '@engine/real-record';
import { boundaryInFlow, negativeInFlow } from '@engine/flow-negative';
import { expect, test } from '@fixtures';
import {
  LOGO_ADMIN as ADMIN,
  LOGO_COMPANY as COMPANY,
  PNG,
  readLogo,
  restoreLogo,
  sameLogo,
  type LogoFile,
} from '../../../support/company-logo';
import { firstAttemptOriginal } from '../../../support/flow-restore';
import { expectStored } from '../../../support/db-stored';
import { text } from '@database/kpost-assertions';

/**
 * Company logo (FR-S05) on the QA company: its admin sets, reads back and removes the logo, and its
 * writes get bad input from this flow. The logo is a shared company setting, so the original is
 * restored whatever happens. Strangers' attempts are in
 * tests/kpost-api/authorization/common/common-company-logo-authorization.spec.ts. QA test server only.
 */

test.describe(
  'KPost Common · company logo set, read back, removed, restored',
  { tag: ['@api', '@platform', '@regression'] },
  () => {
    test.skip(
      process.env.GLOBAL_LIFECYCLE !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'changes the QA company’s logo (restored afterwards); set GLOBAL_LIFECYCLE=true and TEST_DB_MODE=true',
    );
    test.skip(!ADMIN, 'needs the BUSINESS_M admin');

    test('the company’s admin sets, reads back and removes its logo (FR-S05)', async ({
      endpoints,
      databases,
      request,
      validationEngine,
    }) => {
      const db = databases.for('kpost-api');
      const upload = (file: LogoFile, label: string) =>
        endpoints.sendTo(
          'common-update-company-logo',
          { multipart: { file, text: JSON.stringify({ companyID: COMPANY }) } },
          {
            label: `company-logo:${label}`,
            auth: { principal: ADMIN! },
            allowGlobalLifecycle: true,
          },
        );
      const remove = (label: string) =>
        endpoints.sendTo(
          'common-remove-company-logo',
          { body: { companyId: COMPANY } },
          {
            label: `company-logo:${label}`,
            auth: { principal: ADMIN! },
            allowGlobalLifecycle: true,
          },
        );

      // Kept from the first attempt: a retry must not take the bench's own test logo for the original.
      const original = await firstAttemptOriginal('company-242-logo', () =>
        readLogo(endpoints, request),
      );
      expect([200, 404], `the current logo reads cleanly (got ${original.status})`).toContain(
        original.status,
      );
      try {
        // The admin sets a logo and reads back exactly those bytes.
        const set = await upload(
          { name: 'qa-bench-logo.png', mimeType: 'image/png', buffer: PNG },
          'admin-set',
        );
        expect.soft(set.status, 'the admin can set the logo').toBe(200);
        if (set.status === 200)
          // AWSs3ClientServiceImpl.java:1039 names the S3 key <kpostID>/companyLogo/<companyID><file name>;
          // CommonServiceImpl.java:724 (AdminRegistrationRepository.java:27) stores it on the company row.
          await expectStored(
            db,
            'common-update-company-logo',
            {
              table: 'TBL_KPOST_ADMIN_REGISTRATION',
              where: { id: COMPANY },
              columns: {
                company_logo: (value: unknown) =>
                  text(value)?.toLowerCase() ===
                  `${ADMIN!.username}/companyLogo/${COMPANY}qa-bench-logo.png`.toLowerCase(),
              },
              rule: "updateCompanyLogo stores the uploaded logo's S3 key on the company's row",
            },
            endpoints,
          );
        const now = await readLogo(endpoints, request);
        expect.soft(now.status, 'the new logo can be downloaded').toBe(200);
        expect.soft(now.bytes?.equals(PNG), 'the downloaded logo is the uploaded file').toBe(true);
        // The same read through the bench's client, so its answer is checked against the route's
        // file contract (the bytes agree with the Content-Type) like every other flow call.
        const viaClient = await endpoints.sendTo(
          'common-download-company-logo',
          { pathParams: { companyID: String(COMPANY) } },
          { label: 'company-logo:read-contract', auth: { principal: ADMIN! }, allowLiveRead: true },
        );
        await checkOnRealRecord(
          validationEngine,
          'common-download-company-logo',
          { pathParams: { companyID: String(COMPANY) } },
          [COMPANY],
        );
        expect.soft(viaClient.status, 'downloadCompanyLogo serves the logo').toBe(200);
        expect.soft(viaClient.magicType ?? 'no image bytes', 'as a PNG image').toBe('image/png');

        // The admin removes it; the download then answers 404 (no logo), not 500.
        const removed = await remove('admin-remove');
        expect.soft(removed.status, 'the admin can remove the logo').toBe(200);
        if (removed.status === 200)
          // AdminController.java:446 passes a null path; CommonServiceImpl.java:724 writes it.
          await expectStored(
            db,
            'common-remove-company-logo',
            {
              table: 'TBL_KPOST_ADMIN_REGISTRATION',
              where: { id: COMPANY },
              columns: { company_logo: null },
              rule: "removeCompanyLogo clears the logo from the company's row",
            },
            endpoints,
          );
        expect.soft((await readLogo(endpoints, request)).status, 'no logo reads as 404').toBe(404);
        // Removing a logo that is not there is a no-op or a 404, never a crash.
        const again = await remove('admin-remove-again');
        expect
          .soft(again.status, 'removing an absent logo answers 200 or 404, not a server error')
          .toBeLessThan(500);
        // Bad input on the logo writes, by this flow (never the engine); the finally restores it.
        const logoWrite = {
          label: 'company-logo',
          auth: { principal: ADMIN! },
          allowGlobalLifecycle: true,
        };
        await negativeInFlow(
          endpoints,
          'common-remove-company-logo',
          { body: { companyId: COMPANY } },
          logoWrite,
        );
        await boundaryInFlow(
          endpoints,
          'common-remove-company-logo',
          { body: { companyId: COMPANY } },
          logoWrite,
        );
        await negativeInFlow(
          endpoints,
          'common-update-company-logo',
          {
            multipart: {
              file: { name: 'qa-bench-logo.png', mimeType: 'image/png', buffer: PNG },
              text: JSON.stringify({ companyID: COMPANY }),
            },
          },
          logoWrite,
        );
        await boundaryInFlow(
          endpoints,
          'common-update-company-logo',
          {
            multipart: {
              file: { name: 'qa-bench-logo.png', mimeType: 'image/png', buffer: PNG },
              text: JSON.stringify({ companyID: COMPANY }),
            },
          },
          logoWrite,
        );
      } finally {
        const restored = await restoreLogo(endpoints, request, original, upload, remove);
        expect.soft(sameLogo(restored, original), 'the company’s original logo is back').toBe(true);
      }
    });
  },
);
