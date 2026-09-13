import { contractPaths } from '../../../contract/workbook-contract';
import type { EndpointDefinition } from '../../../registry/endpoint-definition';
import { awsApis } from './aws.api';

/** The KPost **AWS** module — S3 presigned URLs and attachment check/delete. `/v2/aws/*`. */
export { awsApis };

/** Documented `/aws` paths that no definition covers. Asserted by the coverage spec. */
export function uncoveredAwsPaths(): string[] {
  const covered = new Set(
    awsApis.flatMap((api: EndpointDefinition) => [
      `${api.method} ${api.path}`,
      ...(api.contractPath ? [`${api.method} ${api.contractPath}`] : []),
    ]),
  );
  return contractPaths('kpost-api')
    .filter((path) => /^\/(v2\/)?aws\//i.test(path))
    .filter((path) => ![...covered].some((key) => key.endsWith(` ${path}`)));
}
