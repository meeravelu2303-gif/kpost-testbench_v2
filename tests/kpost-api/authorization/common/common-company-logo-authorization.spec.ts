import type { Principal } from '@config/auth.config';
import { AUTH_PROFILES } from '@config/auth-profile';
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

/**
 * Only the company's own admin may set or remove its logo (FR-S05; CommonControllerV2
 * updateCompanyLogo and AdminController removeCompanyLogo check isCompanyAdmin). Another company's
 * admin and an ordinary account try both on QA company 242, while its own logo is in place; the
 * read-back decides (the logo must be unchanged), and the admin's identical set is the owner control.
 * The original logo is restored whatever happens. QA test server only.
 */
const P = AUTH_PROFILES.kpost.principals;
const OTHER_ADMIN = P.find((p) => p.key === 'business-s');
const ORDINARY = P.find((p) => p.key === 'personal-5');

test.describe(
  'KPost Security · a company’s logo is changed only by its own admin @api @kpost-api @security',
  {
    tag: ['@api', '@platform', '@security', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(
      process.env.GLOBAL_LIFECYCLE !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'may change the QA company’s logo (restored afterwards); set GLOBAL_LIFECYCLE=true and TEST_DB_MODE=true',
    );
    test.skip(
      !ADMIN || !OTHER_ADMIN || !ORDINARY,
      'needs the BUSINESS_M and BUSINESS_S admins and the 5th QA account',
    );

    test('another company’s admin and an ordinary account cannot set or remove the logo (FR-S05) @api @security', async ({
      endpoints,
      request,
    }) => {
      const upload = (who: Principal, file: LogoFile, label: string) =>
        endpoints.sendTo(
          'common-update-company-logo',
          { multipart: { file, text: JSON.stringify({ companyID: COMPANY }) } },
          {
            label: `company-logo-authz:${label}`,
            auth: { principal: who },
            allowGlobalLifecycle: true,
          },
        );
      const remove = (who: Principal, label: string) =>
        endpoints.sendTo(
          'common-remove-company-logo',
          { body: { companyId: COMPANY } },
          {
            label: `company-logo-authz:${label}`,
            auth: { principal: who },
            allowGlobalLifecycle: true,
          },
        );
      const file = { name: 'qa-bench-logo.png', mimeType: 'image/png', buffer: PNG };

      const original = await firstAttemptOriginal('company-242-logo-authz', () =>
        readLogo(endpoints, request),
      );
      expect([200, 404], `the current logo reads cleanly (got ${original.status})`).toContain(
        original.status,
      );
      try {
        for (const [who, principal] of [
          ['another company’s admin', OTHER_ADMIN!],
          ['an ordinary account', ORDINARY!],
        ] as const) {
          const set = await upload(principal, file, `stranger-set:${principal.key}`);
          const afterSet = await readLogo(endpoints, request);
          const unset = await remove(principal, `stranger-remove:${principal.key}`);
          const afterRemove = await readLogo(endpoints, request);
          for (const [action, id, ex, after] of [
            ['set', 'common-update-company-logo', set, afterSet],
            ['remove', 'common-remove-company-logo', unset, afterRemove],
          ] as const) {
            const changed = !sameLogo(after, original);
            if (changed)
              endpoints.recordBusinessRuleViolation({
                endpointId: id,
                ruleId: `AUTHZ-${id}-not-company-admin`,
                rule: "Only the company's own admin may set or remove its logo (FR-S05).",
                expected: `HTTP 403 for ${who}, and company ${COMPANY}'s logo unchanged`,
                actual: `HTTP ${ex.status}: ${principal.username} (${who}) changed company ${COMPANY}'s logo (it now reads HTTP ${after.status})`,
                request:
                  action === 'set'
                    ? {
                        multipart: {
                          file: '<1x1 PNG>',
                          text: JSON.stringify({ companyID: COMPANY }),
                        },
                      }
                    : { body: { companyId: COMPANY } },
                correlationId: ex.correlationId,
              });
            expect.soft(changed, `${who} must not ${action} this company's logo`).toBe(false);
            expect.soft(ex.status, `${who} is refused the ${action}`).toBe(403);
            // Anything a wrongly accepted call changed is put back before the next attempt.
            if (changed)
              await restoreLogo(
                endpoints,
                request,
                original,
                (f, l) => upload(ADMIN!, f, l),
                (l) => remove(ADMIN!, l),
              );
          }
        }

        // Owner control: the admin's identical set is accepted, so the refusals above mean something.
        const own = await upload(ADMIN!, file, 'owner-control');
        expect(own.status, 'control: the company’s admin can set the logo').toBe(200);
      } finally {
        const restored = await restoreLogo(
          endpoints,
          request,
          original,
          (f, l) => upload(ADMIN!, f, l),
          (l) => remove(ADMIN!, l),
        );
        expect.soft(sameLogo(restored, original), 'the company’s original logo is back').toBe(true);
      }
    });
  },
);
