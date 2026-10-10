import { applyQatestOnly, KEPT_BUSINESS, qatestOnlyOverrides } from '../../src/config/qatest-only';
import { expect, test } from '@fixtures';

/**
 * QATEST_ONLY must put the PERSONAL roles on the qatest accounts alone, keep the business tiers
 * (owner decision 2026-10-10: they have no qatest stand-in and must stay tested) with their own
 * password, drop the older personal-6 account, and fail loudly on a missing qatest account instead
 * of quietly falling back to a shared one.
 */

const base = {
  QATEST1_KPOST_ID: 'qatest1@x',
  QATEST2_KPOST_ID: 'qatest2@x',
  QATEST3_KPOST_ID: 'qatest3@x',
  QATEST4_KPOST_ID: 'qatest4@x',
  QATEST5_KPOST_ID: 'qatest5@x',
  QATEST6_KPOST_ID: 'qatest6@x',
  QATEST_SHARED_PASSWORD: 'shared-pw',
};

test.describe('qatest-only account switch', () => {
  test('every role is re-pointed at a qatest account @framework', () => {
    const out = qatestOnlyOverrides({ ...base, QA_KPOST_ID: 'old@kpost.in' });
    expect(out.QA_KPOST_ID).toBe('qatest1@x');
    expect(out.QA_VICTIM_KPOST_ID).toBe('qatest2@x');
    expect(out.QA_PERSONAL_3_KPOST_ID).toBe('qatest3@x');
    expect(out.QA_PERSONAL_4_KPOST_ID).toBe('qatest4@x');
    expect(out.QA_PERSONAL_5_KPOST_ID).toBe('qatest5@x');
    expect(out.QA_FORGOT_PASSWORD_KPOST_ID).toBe('qatest6@x');
    expect(out.QA_PASSWORD).toBe('shared-pw');
  });

  test('the older personal-6 account is removed, the business tiers are not @framework', () => {
    const out = qatestOnlyOverrides(base);
    expect('QA_PERSONAL_6_KPOST_ID' in out, 'personal-6 is listed for removal').toBe(true);
    expect(out.QA_PERSONAL_6_KPOST_ID).toBeUndefined();
    for (const name of KEPT_BUSINESS) {
      expect(name in out, `${name} must not be touched by the switch`).toBe(false);
    }
  });

  test('applying it re-points the personal roles and keeps the business accounts logging in @framework', () => {
    const env: Record<string, string | undefined> = {
      ...base,
      QATEST_ONLY: 'true',
      QA_KPOST_ID: 'old@kpost.in',
      QA_PASSWORD: 'old-pw',
      QA_PERSONAL_6_KPOST_ID: 'old6@kpost.in',
      QA_BUSINESS_M_KPOST_ID: 'biz@kpost.in',
      QA_BUSINESS_M_COMPANY_ID: '242',
    };
    expect(applyQatestOnly(env)).toBe(true);
    expect(env.QA_KPOST_ID).toBe('qatest1@x');
    expect(env.QA_PASSWORD).toBe('shared-pw');
    expect('QA_PERSONAL_6_KPOST_ID' in env, 'personal-6 is gone').toBe(false);
    expect(env.QA_BUSINESS_M_KPOST_ID, 'the business account survives').toBe('biz@kpost.in');
    expect(env.QA_BUSINESS_M_COMPANY_ID, 'its company id survives').toBe('242');
    expect(env.QA_BUSINESS_PASSWORD, 'its password is captured before QA_PASSWORD moves').toBe(
      'old-pw',
    );
  });

  test('an explicit QA_BUSINESS_PASSWORD is respected @framework', () => {
    const out = qatestOnlyOverrides({
      ...base,
      QA_PASSWORD: 'old-pw',
      QA_BUSINESS_PASSWORD: 'biz-pw',
    });
    expect('QA_BUSINESS_PASSWORD' in out, 'not overwritten').toBe(false);
  });

  test('it does nothing unless switched on @framework', () => {
    const env: Record<string, string | undefined> = { QA_KPOST_ID: 'old@kpost.in' };
    expect(applyQatestOnly(env)).toBe(false);
    expect(env.QA_KPOST_ID).toBe('old@kpost.in');
  });

  test('a missing qatest account fails loudly instead of falling back @framework', () => {
    const { QATEST3_KPOST_ID: _omit, ...partial } = base;
    expect(() => qatestOnlyOverrides(partial)).toThrow(/QATEST3_KPOST_ID/);
    expect(() => qatestOnlyOverrides({ ...base, QATEST_SHARED_PASSWORD: '' })).toThrow(
      /QATEST_SHARED_PASSWORD/,
    );
  });
});
