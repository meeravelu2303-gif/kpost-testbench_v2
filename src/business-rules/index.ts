import { BusinessRuleRegistry } from './business-rule';

/**
 * Endpoint-specific business rules, referenced by ID from a definition's `businessRules`.
 *
 * Empty on purpose. KPost's business rules are asserted by the module feature specs
 * (`tests/api/kpost/<module>/feature.spec.ts`, through `recordBusinessRuleViolation`), because a
 * real rule usually needs multi-step state the generic sweep cannot set up. The registry stays so a
 * definition-level rule can be added without touching the engine; an unregistered id still fails
 * loudly rather than being ignored.
 */
export const businessRuleRegistry = new BusinessRuleRegistry();
