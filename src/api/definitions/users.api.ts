import { randomUUID } from 'node:crypto';
import type { Role } from '@config/auth.config';
import { buildUserPayload } from '@data/factories';
import type { EndpointDefinition, RequestFactoryHelpers } from '../registry/endpoint-definition';
import {
  createUserRequestSchema,
  listUsersQuerySchema,
  updateUserRequestSchema,
  userIdParamsSchema,
  userListSchema,
  userSchema,
} from '../schemas/user.schema';

/**
 * Users API. Only endpoint-specific facts live here — no validation logic.
 * Authentication, status, schema, headers, security, ... are applied by the central engine.
 */
const USER_MANAGERS: readonly Role[] = ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN'];

/** Reuses `create-user` (and its payload) instead of duplicating it. */
const existingUserId = async (helpers: RequestFactoryHelpers): Promise<string> =>
  (await helpers.call<{ id: string }>('create-user')).id;

export const createUserApi: EndpointDefinition = {
  id: 'create-user',
  mockFixture: true,
  method: 'POST',
  path: '/users',
  summary: 'Create a user in a company',
  tags: ['users', 'critical'],
  authorization: {
    roles: USER_MANAGERS,
    tenantScoped: true,
    privilegeEscalation: { role: 'COMPANY_ADMIN', overrides: { body: { role: 'ADMIN' } } },
  },
  request: ({ tenantId }) => ({ body: buildUserPayload(tenantId) }),
  requestSchema: createUserRequestSchema,
  responseSchema: userSchema,
  businessRules: ['duplicate-user', 'company-user-limit', 'blocked-company'],
  database: { validations: ['user-created'] },
};

export const getUserApi: EndpointDefinition = {
  id: 'get-user',
  mockFixture: true,
  method: 'GET',
  path: '/users/{id}',
  summary: 'Get a user by ID',
  tags: ['users', 'critical'],
  authorization: { roles: USER_MANAGERS, tenantScoped: true },
  request: async (helpers) => ({ pathParams: { id: await existingUserId(helpers) } }),
  pathParamsSchema: userIdParamsSchema,
  responseSchema: userSchema,
};

export const listUsersApi: EndpointDefinition = {
  id: 'list-users',
  mockFixture: true,
  method: 'GET',
  path: '/users',
  summary: 'List users (paginated)',
  tags: ['users'],
  authorization: { roles: USER_MANAGERS },
  request: () => ({ query: { page: 1, pageSize: 10 } }),
  querySchema: listUsersQuerySchema,
  responseSchema: userListSchema,
  pagination: true,
};

export const updateUserApi: EndpointDefinition = {
  id: 'update-user',
  mockFixture: true,
  method: 'PUT',
  path: '/users/{id}',
  summary: "Replace a user's profile and role",
  tags: ['users'],
  authorization: {
    roles: USER_MANAGERS,
    tenantScoped: true,
    privilegeEscalation: { role: 'COMPANY_ADMIN', overrides: { body: { role: 'ADMIN' } } },
  },
  request: async (helpers) => ({
    pathParams: { id: await existingUserId(helpers) },
    body: { firstName: 'Updated', lastName: `User-${randomUUID().slice(0, 8)}`, role: 'USER' },
  }),
  pathParamsSchema: userIdParamsSchema,
  requestSchema: updateUserRequestSchema,
  responseSchema: userSchema,
  database: { validations: ['user-updated'] },
};

export const deleteUserApi: EndpointDefinition = {
  id: 'delete-user',
  mockFixture: true,
  method: 'DELETE',
  path: '/users/{id}',
  summary: 'Soft-delete a user',
  tags: ['users'],
  authorization: { roles: USER_MANAGERS, tenantScoped: true },
  request: async (helpers) => ({ pathParams: { id: await existingUserId(helpers) } }),
  pathParamsSchema: userIdParamsSchema,
  database: { validations: ['user-deleted'] },
};

export const userApis = [createUserApi, getUserApi, listUsersApi, updateUserApi, deleteUserApi];
