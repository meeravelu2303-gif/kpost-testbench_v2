import { BusinessRuleRegistry } from './business-rule';
import { duplicateCompanyNameRule } from './companies/duplicate-company-name.rule';
import { blockedCompanyRule } from './users/blocked-company.rule';
import { companyUserLimitRule } from './users/company-user-limit.rule';
import { duplicateUserRule } from './users/duplicate-user.rule';

/** Endpoint-specific business rules, referenced by ID from endpoint definitions. */
export const businessRuleRegistry = new BusinessRuleRegistry().register(
  duplicateUserRule,
  companyUserLimitRule,
  blockedCompanyRule,
  duplicateCompanyNameRule,
);
