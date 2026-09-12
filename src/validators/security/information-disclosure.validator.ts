import { apiConfig } from '@config/api.config';
import { defineValidator } from '@engine/validator';
import { fromChecks, outcome, type CheckDetail } from '@engine/validation-result';
import { findLeaks } from './leak-patterns';

const VERSIONED_SERVER = /\d+\.\d+/;

/** Inspects every response of the run for stack traces, SQL, paths, credentials and stack headers. */
export const informationDisclosureValidator = defineValidator({
  name: 'security.information-disclosure',
  category: 'SECURITY',
  severity: 'HIGH',
  description: 'No stack traces, SQL, file paths, credentials or technology headers are disclosed',
  toggle: 'security',
  stage: 'aggregate',
  check: (context) => {
    const findings: CheckDetail[] = context.exchanges.flatMap((exchange) => {
      const problems = [
        ...findLeaks(exchange.bodyText),
        ...apiConfig.disclosureHeaders.filter((h) => exchange.header(h)).map((h) => `${h} header`),
        ...(VERSIONED_SERVER.test(exchange.header('server') ?? '')
          ? ['versioned Server header']
          : []),
      ];
      return problems.length
        ? [
            {
              name: exchange.label,
              status: 'FAILED' as const,
              expected: 'nothing disclosed',
              actual: problems,
              message: problems.join(', '),
              correlationId: exchange.correlationId,
            },
          ]
        : [];
    });
    return findings.length
      ? fromChecks(findings, 'responses with disclosures')
      : outcome.passed(`${context.exchanges.length} responses disclose no internals`, {
          expected: 'nothing disclosed',
          actual: 'none found',
        });
  },
});
