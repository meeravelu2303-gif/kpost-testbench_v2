import type { TestInfo } from '@playwright/test';
import type { ExchangeEvidence } from '../failure-analysis/index';
import type { ValidationReport } from '@engine/validation-result';
import { formatReport } from './report-formatter';

/** Attachment name the validation reporter looks for. */
export const VALIDATION_REPORT_ATTACHMENT = 'validation-report.json';

/**
 * Attachment carrying exchange evidence that rides on no `ValidationReport` — a lifecycle spec's own
 * calls, and every `cleanup`-phase exchange. `EvidenceReporter` reads it.
 */
export const EXCHANGE_EVIDENCE_ATTACHMENT = 'exchange-evidence.json';

/**
 * Attaches evidence for exchanges the engine never saw, so cleanup and lifecycle traffic is durable
 * rather than dying with the worker. Never throws: evidence must not be able to fail a test.
 */
export async function attachExchangeEvidence(
  testInfo: TestInfo,
  evidence: readonly ExchangeEvidence[],
): Promise<void> {
  if (evidence.length === 0) return;
  try {
    await testInfo.attach(EXCHANGE_EVIDENCE_ATTACHMENT, {
      body: JSON.stringify(evidence),
      contentType: 'application/json',
    });
  } catch {
    // Reported by the evidence reporter as a missing record, never as a test failure.
  }
}

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
