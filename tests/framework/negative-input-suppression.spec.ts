import { isLenientAcceptanceFalsePositive } from '../../src/bug-tracker/bug-candidate';
import type { ValidationResult } from '@engine/validation-result';
import { expect, test } from '@playwright/test';

/**
 * Guard for the "lenient input is not a bug" rule (see #534).
 *
 * KPost fields are often optional filters: a null / empty / differently-typed value is legitimately
 * ACCEPTED and the endpoint returns 2xx with data. A negative-input probe flagging that is a false
 * positive and must NOT be filed. But a 5xx CRASH on bad input is a real fault and must still file.
 */
const result = (validatorName: string, statuses: number[]): ValidationResult =>
  ({
    validatorName,
    status: 'FAILED',
    details: statuses.map((code, i) => ({
      name: `case ${i}`,
      status: 'FAILED' as const,
      expected: [400, 422],
      actual: code,
    })),
  }) as unknown as ValidationResult;

test.describe('negative-input false-positive suppression @framework', () => {
  test('null-value ACCEPTED with 200 is suppressed (not a bug — #534 class)', () => {
    expect(isLenientAcceptanceFalsePositive(result('request.null-value', [200, 200]))).toBe(true);
  });

  test('empty-body ACCEPTED with 200 is suppressed', () => {
    expect(isLenientAcceptanceFalsePositive(result('request.empty-body', [200]))).toBe(true);
  });

  test('data-type ACCEPTED with 204 is suppressed', () => {
    expect(isLenientAcceptanceFalsePositive(result('request.data-type', [204]))).toBe(true);
  });

  test('null-value that CRASHED with 500 is KEPT (real defect)', () => {
    expect(isLenientAcceptanceFalsePositive(result('request.null-value', [500]))).toBe(false);
  });

  test('mixed 200+500 is KEPT (a crash occurred)', () => {
    expect(isLenientAcceptanceFalsePositive(result('request.null-value', [200, 500]))).toBe(false);
  });

  test('a non-negative-input validator is never suppressed here', () => {
    expect(isLenientAcceptanceFalsePositive(result('flow.server-error', [500]))).toBe(false);
    expect(isLenientAcceptanceFalsePositive(result('security.injection', [200]))).toBe(false);
    expect(isLenientAcceptanceFalsePositive(result('response.status-code', [200]))).toBe(false);
  });
});
