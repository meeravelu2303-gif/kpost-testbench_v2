import type { ValidationReport } from '@engine/validation-result';

const MAX_MESSAGE_CHARS = 110;

const pad = (value: string, width: number): string => value.padEnd(width);

/** Human-readable table of one endpoint's validation results. */
export function formatReport(report: ValidationReport): string {
  const header = [
    `Endpoint: ${report.endpoint} (${report.endpointId})`,
    `Profile: ${report.profile} | Environment: ${report.environment} | Build: ${report.build} | Run: ${report.testRunId}`,
    `Correlation ID: ${report.correlationId} | Duration: ${report.durationMs}ms`,
    '',
    `${pad('STATUS', 8)}${pad('CATEGORY', 15)}${pad('VALIDATOR', 40)}${pad('SEVERITY', 10)}${pad('TIME', 8)}MESSAGE`,
  ];
  const rows = report.results.map(
    (r) =>
      `${pad(r.status, 8)}${pad(r.category, 15)}${pad(r.validatorName, 40)}${pad(r.severity, 10)}${pad(`${r.durationMs}ms`, 8)}` +
      (r.message.length > MAX_MESSAGE_CHARS
        ? `${r.message.slice(0, MAX_MESSAGE_CHARS)}…`
        : r.message),
  );
  const { total, passed, failed, warnings, skipped } = report.summary;
  const footer = [
    '',
    `Summary: ${total} validations — ${passed} passed, ${failed} failed, ${warnings} warnings, ${skipped} skipped`,
    `Quality gate: ${report.gate.passed ? 'PASSED' : `FAILED (${report.gate.blocking.join(', ')})`}`,
  ];
  return [...header, ...rows, ...footer].join('\n');
}
