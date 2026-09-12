import { PROFILE_SETS } from '@engine/validation-policy';
import { defineValidator } from '@engine/validator';
import { runPayloadProbes, type AttackPayload } from './payload-probes';

const INJECTION_PAYLOADS: readonly AttackPayload[] = [
  { name: 'SQL tautology', value: "' OR '1'='1' --" },
  { name: 'SQL stacked query', value: '1; DROP TABLE users; --' },
  { name: 'SQL comment bypass', value: "admin'--" },
  { name: 'NoSQL $ne operator', value: { $ne: null } },
  { name: 'NoSQL $gt operator', value: { $gt: '' } },
];

export const injectionValidator = defineValidator({
  name: 'security.injection',
  category: 'SECURITY',
  severity: 'CRITICAL',
  description: 'SQL/NoSQL injection payloads never cause 5xx, leaks or (where required) acceptance',
  toggle: 'security',
  profiles: PROFILE_SETS.SECURITY,
  stage: 'probe',
  check: (context) => runPayloadProbes(context, 'security.injection', INJECTION_PAYLOADS),
});
