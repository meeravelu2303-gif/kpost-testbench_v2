import type { SuiteId } from '@config/ownership.config';
import type { ResponseContractId } from '@config/response-contract';
import { workbookContract } from '../contract/workbook-contract';
import type { EndpointDefinition } from '../registry/endpoint-definition';
import type { KpostEndpointConfig } from './kpost/kpost-endpoint';

/** What differs between the per-suite factories; everything else is mapped once, below. */
export interface SuiteScope {
  suite: SuiteId;
  responseContract: ResponseContractId;
  /** Tags every endpoint of the suite carries, ahead of the endpoint's own. */
  suiteTags: readonly string[];
  /** Applied when the endpoint states no `authentication` of its own. */
  defaultAuthentication: NonNullable<EndpointDefinition['authentication']>;
  /** Prefix the REQUEST path is called on (KMail's `/kmail5/v2`); the contract path stays unprefixed. */
  pathPrefix?: string;
}

/**
 * Builds a definition from a config for one suite and cross-checks it against that suite's generated
 * contract. The single place a config field becomes a definition field: the per-suite factories
 * (`defineKpostEndpoint`, `defineKmailEndpoint`, `defineAdminEndpoint`) only supply their
 * `SuiteScope`. Before this existed each factory repeated the mapping, and the KMail copy silently
 * dropped the `requestSchema` override — a config field one suite honoured and another ignored.
 *
 * `workbookContract` throws when the method and path are not in the contract, so a renamed or retired
 * endpoint fails at import time rather than becoming a test that validates nothing.
 */
export function buildDefinition(
  config: KpostEndpointConfig,
  scope: SuiteScope,
): EndpointDefinition {
  const documentedPath = config.contractPath ?? config.path;
  const contract = workbookContract(
    scope.suite,
    config.contractMethod ?? config.method,
    documentedPath,
  );

  return {
    id: config.id,
    method: config.method,
    path: `${scope.pathPrefix ?? ''}${config.path}`,
    // With a request prefix, the unprefixed documented path is what schema lookup and coverage use.
    contractPath: scope.pathPrefix ? documentedPath : config.contractPath,
    contractMethod: config.contractMethod,
    suite: scope.suite,
    responseContract: scope.responseContract,
    summary: config.summary,
    tags: [...scope.suiteTags, ...(config.tags ?? [])],
    requirements: config.requirements,
    authentication: config.authentication ?? scope.defaultAuthentication,
    expectedStatus: config.expectedStatus,
    envelope: config.envelope,
    contentType: config.contentType,
    request: config.request,
    requestSchema: config.requestSchema ?? contract.requestSchema,
    responseSchema: contract.responseSchema,
    destructive: config.destructive,
    sideEffect: config.sideEffect,
    productionSafe: config.productionSafe,
    otpDependent: config.otpDependent,
    validations: config.validations,
    skipValidators: config.skipValidators,
    businessRules: config.businessRules,
    security: config.security,
    performance: config.performance,
  };
}
