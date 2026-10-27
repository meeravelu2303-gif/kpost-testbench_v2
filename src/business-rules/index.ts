import { BusinessRuleRegistry } from './business-rule';

/**
 * Endpoint-level business rules, by ID. Empty on purpose: KPost's rules need multi-step state, so
 * the module feature specs assert them (`recordBusinessRuleViolation`).
 */
export const businessRuleRegistry = new BusinessRuleRegistry();
