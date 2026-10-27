import { apiConfig } from '@config/api.config';
import { env } from '@config/env';
import { defineValidator } from '@engine/validator';
import { fromChecks, outcome, type CheckDetail } from '@engine/validation-result';

export const securityHeadersValidator = defineValidator({
  name: 'security.security-headers',
  category: 'SECURITY',
  severity: 'MEDIUM',
  description:
    'Security headers (nosniff, frame options, CSP, referrer policy, no-store, HSTS) are set',
  toggle: 'security',
  check: ({ primary }) => {
    // No HTTP response means no headers to judge, not "all headers missing".
    if (primary.transportError)
      return outcome.skipped('no HTTP response was received — headers cannot be judged');
    const required: [string, RegExp][] = Object.entries(apiConfig.securityHeaders);
    if (env.API_BASE_URL.startsWith('https://'))
      required.push([apiConfig.hstsHeader, /max-age=\d+/i]);
    const checks: CheckDetail[] = required.map(([name, pattern]) => {
      const value = primary.header(name);
      return {
        name,
        status: value !== undefined && pattern.test(value) ? 'PASSED' : 'FAILED',
        expected: pattern.source,
        actual: value ?? '(missing)',
      };
    });
    return fromChecks(checks, 'security headers');
  },
});
