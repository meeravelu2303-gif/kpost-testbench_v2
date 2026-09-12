import type { TestInfo } from '@playwright/test';
import type { ValidationReport } from '@engine/validation-result';
import { formatReport } from './report-formatter';

/** Attachment name the validation reporter looks for. */
export const VALIDATION_REPORT_ATTACHMENT = 'validation-report.json';

/** Attaches the (already masked) report as JSON for tooling and as text for humans. */
export async function attachValidationReport(
  testInfo: TestInfo,
  report: ValidationReport,
): Promise<void> {
  await testInfo.attach(VALIDATION_REPORT_ATTACHMENT, {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach(`validation-${report.endpointId}.txt`, {
    body: formatReport(report),
    contentType: 'text/plain',
  });
}
