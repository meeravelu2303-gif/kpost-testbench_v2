import { ApiRegistry } from '../registry/api-registry';
import { loginApi } from './auth.api';
import { companyApis } from './companies.api';
import { dictionaryApis } from './dictionary.api';
import { healthCheckApi } from './health.api';
import { userApis } from './users.api';

/** Every endpoint under test. Registering here is all a new endpoint needs. */
export const apiRegistry = new ApiRegistry().register(
  healthCheckApi,
  loginApi,
  ...userApis,
  ...companyApis,
  ...dictionaryApis,
);
