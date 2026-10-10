import { applyQatestOnly, qatestOnlyOverrides } from '../../src/config/qatest-only';
import { expect, test } from '@fixtures';

/**
 * QATEST_ONLY must put the bench on the qatest accounts alone. These pin that every role is
 * re-pointed, that no older or business account survives, and that a missing qatest account fails
 * loudly instead of quietly falling back to a shared one.
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

  test('business and older-only accounts are removed, not kept @framework', () => {
    const out = qatestOnlyOverrides(base);
    for (const name of [
      'QA_BUSINESS_M_KPOST_ID',
      'QA_BUSINESS_M_USER_1_KPOST_ID',
      'QA_BUSINESS_S_KPOST_ID',
      'QA_PERSONAL_6_KPOST_ID',
      'QA_COMPANY_ID',
    ]) {
      expect(name in out, `${name} must be listed for removal`).toBe(true);
      expect(out[name], `${name} must be removed`).toBeUndefined();
    }
  });

  test('applying it leaves no older account in the environment @framework', () => {
    const env: Record<string, string | undefined> = {
      ...base,
      QATEST_ONLY: 'true',
      QA_KPOST_ID: 'old@kpost.in',
      QA_PASSWORD: 'old-pw',
      QA_BUSINESS_M_KPOST_ID: 'biz@kpost.in',
    };
    expect(applyQatestOnly(env)).toBe(true);
    expect(env.QA_KPOST_ID).toBe('qatest1@x');
    expect(env.QA_PASSWORD).toBe('shared-pw');
    expect('QA_BUSINESS_M_KPOST_ID' in env).toBe(false);
  });

  test('it does nothing unless switched on @framework', () => {
    const env: Record<string, string | undefined> = { QA_KPOST_ID: 'old@kpost.in' };
    expect(applyQatestOnly(env)).toBe(false);
    expect(env.QA_KPOST_ID).toBe('old@kpost.in');
  });

  test('it does nothing against the mock, even if switched on @framework', () => {
    const env: Record<string, string | undefined> = {
      ...base,
      QATEST_ONLY: 'true',
      MOCK_API: 'true',
      QA_KPOST_ID: 'qa.bench@kpost.in',
    };
    expect(applyQatestOnly(env)).toBe(false);
    expect(env.QA_KPOST_ID).toBe('qa.bench@kpost.in');
  });

  test('a missing qatest account fails loudly instead of falling back @framework', () => {
    const { QATEST3_KPOST_ID: _omit, ...partial } = base;
    expect(() => qatestOnlyOverrides(partial)).toThrow(/QATEST3_KPOST_ID/);
    expect(() => qatestOnlyOverrides({ ...base, QATEST_SHARED_PASSWORD: '' })).toThrow(
      /QATEST_SHARED_PASSWORD/,
    );
  });
});
