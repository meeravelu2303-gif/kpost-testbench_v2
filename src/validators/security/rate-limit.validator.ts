import { apiConfig } from '@config/api.config';
import { thresholds } from '@config/thresholds.config';
import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { outcome } from '@engine/validation-result';

/** Opt-in per endpoint (`security.rateLimit`) and SECURITY/FULL only — it deliberately floods. */
export const rateLimitValidator = defineValidator({
  name: 'security.rate-limit',
  category: 'SECURITY',
  severity: 'MEDIUM',
  description: 'Bursts above the configured limit are throttled with 429 and Retry-After',
  toggle: 'security',
  profiles: PROFILE_SETS.SECURITY,
  stage: 'probe',
  appliesTo: ({ endpoint }) =>
    endpoint.security.rateLimit ? true : 'no rate limit configured for this endpoint',
  check: async (context) => {
    const config = context.endpoint.security.rateLimit;
    if (!config) return outcome.skipped('no rate limit configured');
    const spec = await config.request(context.helpers);
    const burst = Math.min(config.maxRequests + 1, thresholds.security.maxRateLimitBurst);

    for (let attempt = 1; attempt <= burst; attempt += 1) {
      const exchange = await context.send(spec, { label: `security.rate-limit:#${attempt}` });
      if (exchange.status !== apiConfig.rateLimitStatus) continue;
      const retryAfter = exchange.header('retry-after');
      const extras = {
        expected: `429 with Retry-After after ${config.maxRequests} requests`,
        actual: { attempt, retryAfter },
        correlationId: exchange.correlationId,
      };
      return retryAfter
        ? outcome.passed(`throttled at request #${attempt} (Retry-After: ${retryAfter})`, extras)
        : outcome.failed(
            `throttled at request #${attempt} but Retry-After header is missing`,
            extras,
          );
    }
    return outcome.failed(
      `no ${apiConfig.rateLimitStatus} after ${burst} requests (limit ${config.maxRequests})`,
      {
        expected: apiConfig.rateLimitStatus,
        actual: 'never throttled',
      },
    );
  },
});
