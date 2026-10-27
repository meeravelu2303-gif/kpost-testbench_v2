import { AUTH_PROFILES } from '@config/auth-profile';
import { testData } from '@config/test-data.config';
import { expect, test } from '@fixtures';
import { locationPayload, tierPayload, variablePayload } from '../support/screen-payloads';

const K = AUTH_PROFILES.kpost;
const businessM = K.principals.find((p) => p.key === 'business-m');
const businessS = K.principals.find((p) => p.key === 'business-s');

/**
 * Admin cross-tenant read-by-id: getLocationById takes a bare id with no company check. BUSINESS_M
 * creates a location; BUSINESS_S (another QA company) must not read it by id alone.
 */
test.describe('KPost Admin · cross-tenant read-by-id IDOR @api @admin-api @security', () => {
  test.skip(!businessM || !businessS, 'needs both BUSINESS_M and BUSINESS_S principals');
  test.skip(
    testData.businessMKpostId.includes('qa.business.m'),
    'needs the BUSINESS_M account (QA_BUSINESS_M_KPOST_ID + QA_BUSINESS_M_COMPANY_ID)',
  );

  test("a workplace location created by company 242 must not be readable by id from company 1034's token", async ({
    endpoints,
  }) => {
    const marker = `QA Loc XTENANT ${Date.now()}`;
    // A location needs its workplace level: company 242 creates both first.
    const owned = { auth: { principal: businessM! }, allowLiveWrite: true };
    const idOf = (text: string | undefined): string | undefined =>
      (JSON.parse(text || '{}') as { value?: Array<{ id?: string }> }).value?.[0]?.id;
    const tierId = idOf(
      (
        await endpoints.sendTo(
          'admin-workplace-tier-attribute-save',
          { body: [tierPayload(`${marker} Tier`)] },
          { label: 'admin:xtenant-tier-create', ...owned },
        )
      ).bodyText,
    );
    const varId = tierId
      ? idOf(
          (
            await endpoints.sendTo(
              'admin-workplace-tier-variable-save',
              { body: [variablePayload(tierId, `${marker} Var`)] },
              { label: 'admin:xtenant-var-create', ...owned },
            )
          ).bodyText,
        )
      : undefined;
    const dropParents = async (): Promise<void> => {
      if (varId)
        await endpoints
          .sendTo(
            'admin-workplace-tier-variable-delete',
            { body: { id: varId } },
            { label: 'admin:xtenant-var-cleanup', ...owned },
          )
          .catch(() => undefined);
      if (tierId)
        await endpoints
          .sendTo(
            'admin-workplace-tier-attribute-delete',
            { body: { id: tierId } },
            { label: 'admin:xtenant-tier-cleanup', ...owned },
          )
          .catch(() => undefined);
    };
    const created = await endpoints.sendTo(
      'admin-workplace-location-save',
      { body: [locationPayload(tierId ?? '', varId ?? '', marker)] },
      { label: 'admin:xtenant-loc-create', auth: { principal: businessM! }, allowLiveWrite: true },
    );
    const createdParsed = JSON.parse(created.bodyText || '{}') as { value?: Array<{ id: string }> };
    const mine = (createdParsed.value ?? [])[0];
    if (!mine) await dropParents();
    test.skip(
      !mine,
      `the probe location was not created (HTTP ${created.status} ${(created.bodyText ?? '').slice(0, 120)})`,
    );
    if (!mine) return;

    try {
      // Owner control: without it, a refusal for the stranger proves nothing.
      const own = await endpoints.sendTo(
        'admin-workplace-location-by-id',
        { body: { id: mine.id } },
        {
          label: 'admin:xtenant-loc-owner-read',
          auth: { principal: businessM! },
          allowLiveRead: true,
        },
      );
      expect(
        own.status === 200 && own.bodyText.includes(mine.id),
        `owner control: company 242 reads its own location by id (HTTP ${own.status})`,
      ).toBe(true);

      const cross = await endpoints.sendTo(
        'admin-workplace-location-by-id',
        { body: { id: mine.id } },
        {
          label: 'admin:xtenant-loc-cross-read',
          auth: { principal: businessS! },
          allowLiveRead: true,
          allowLiveWrite: true,
        },
      );

      const leaked = cross.status < 300 && cross.bodyText.includes(mine.id);
      if (leaked) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'admin-workplace-location-by-id',
          ruleId: 'IDOR-admin-cross-tenant-read-location',
          rule:
            "A read-by-id must verify the caller's own companyId owns the target record before " +
            'returning it — a BUSINESS_S-authenticated caller must not be able to read a location ' +
            'created by BUSINESS_M by naming its id alone.',
          expected: 'the read is refused; the location is not returned to a non-owning caller',
          actual: `the read succeeded (${cross.status}) and returned the full record to BUSINESS_S`,
          request: { body: { id: mine.id } },
        });
      }
      expect(
        leaked,
        "a workplace location created by company 242 must not be readable by company 1034's token",
      ).toBe(false);
    } finally {
      const del = await endpoints.sendTo(
        'admin-workplace-location-delete',
        { body: { id: mine.id } },
        {
          label: 'admin:xtenant-loc-cleanup',
          auth: { principal: businessM! },
          allowLiveWrite: true,
        },
      );
      expect.soft(del.status, 'the probe location is deleted again').toBe(200);
      await dropParents();
    }
  });
});
