import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { signToken, verifyToken, type Claims } from './jwt.ts';
import { kpostCommonRoutes } from './kpost-common.ts';

/**
 * Local, in-memory stand-in for the KPost API so the validation framework can be exercised
 * end to end without a deployed environment. Started by playwright.config.ts when MOCK_API is on.
 * It is the "system under test" here — its validation is intentionally independent of the
 * test bench's contracts. Test-only routes live under /__test.
 */

const PORT = Number(process.env.MOCK_API_PORT ?? 4010);
const MAX_BODY_BYTES = 1_048_576;
const TOKEN_TTL_SECONDS = 3_600;
const LOGIN_FAILURE_LIMIT = 10;
const LOGIN_FAILURE_WINDOW_MS = 60_000;
const DEFAULT_PAGE_SIZE = 20;
const LANGUAGES = ['en', 'de', 'fr'] as const;

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'COMPANY_ADMIN' | 'USER';
const USER_MANAGERS: readonly Role[] = ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN'];
const PLATFORM_ADMINS: readonly Role[] = ['SUPER_ADMIN', 'ADMIN'];
const ALL_ROLES: readonly Role[] = ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN', 'USER'];

interface Company {
  id: string;
  name: string;
  contactEmail: string;
  maxUsers: number;
  status: 'ACTIVE' | 'BLOCKED';
  website: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  companyId: string;
  phone: string | null;
  profile: { title: string; website: string | null } | null;
  specialityIds: string[];
  isActive: boolean;
  passwordHash: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  deletedAt: string | null;
}

interface Term {
  id: string;
  term: string;
  language: (typeof LANGUAGES)[number];
  definition: string;
  sourceUrl: string | null;
  isPublished: boolean;
  updatedAt: string;
}

interface SeedFile {
  companies: Omit<Company, 'createdAt' | 'updatedAt' | 'createdBy'>[];
  principals: { key: string; role: Role; tenantId?: string; username: string; password: string }[];
  dictionaryTerms: string[];
}

interface FieldError {
  field?: string;
  message: string;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors?: FieldError[];
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { errors?: FieldError[]; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.errors = options.errors;
    this.headers = options.headers;
  }
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  correlationId: string;
}

// ---------------------------------------------------------------------------- store + seed

const seed = JSON.parse(readFileSync(new URL('./seed.json', import.meta.url), 'utf8')) as SeedFile;
const now = (): string => new Date().toISOString();
const hashPassword = (password: string): string =>
  createHash('sha256').update(password).digest('hex');

const companies = new Map<string, Company>();
const users = new Map<string, User>();
const terms: Term[] = [];
const loginFailures = new Map<string, number[]>();

const seededAt = now();
for (const company of seed.companies) {
  companies.set(company.id, {
    ...company,
    createdAt: seededAt,
    updatedAt: seededAt,
    createdBy: null,
  });
}
const defaultCompanyId = seed.companies[0]?.id ?? randomUUID();
for (const principal of seed.principals) {
  const id = randomUUID();
  users.set(id, {
    id,
    email: principal.username,
    firstName: principal.key,
    lastName: 'Seed',
    role: principal.role,
    companyId: principal.tenantId ?? defaultCompanyId,
    phone: null,
    profile: null,
    specialityIds: [],
    isActive: true,
    passwordHash: hashPassword(principal.password),
    createdAt: seededAt,
    updatedAt: seededAt,
    createdBy: null,
    deletedAt: null,
  });
}
for (const term of seed.dictionaryTerms) {
  for (const language of LANGUAGES) {
    const slug = term.toLowerCase().replace(/\s+/g, '-');
    terms.push({
      id: randomUUID(),
      term,
      language,
      definition: `${term} (${language}): mock dictionary definition`,
      sourceUrl: `https://kpost.test/dictionary/${slug}`,
      isPublished: true,
      updatedAt: seededAt,
    });
  }
}

// ---------------------------------------------------------------------------- contracts (SUT side)

const personName = z.string().min(1).max(50);
const phone = z.string().regex(/^\+[1-9]\d{7,14}$/);
const assignableRole = z.enum(['ADMIN', 'COMPANY_ADMIN', 'USER']);

const createUserBody = z.strictObject({
  email: z.email().max(254),
  firstName: personName,
  lastName: personName,
  role: assignableRole,
  companyId: z.uuid(),
  phone: phone.optional(),
  profile: z
    .strictObject({ title: z.string().min(1).max(100), website: z.url().optional() })
    .optional(),
  specialityIds: z.array(z.uuid()).max(5).optional(),
});
const updateUserBody = z.strictObject({
  firstName: personName,
  lastName: personName,
  role: assignableRole,
  phone: phone.optional(),
});
const createCompanyBody = z.strictObject({
  name: z.string().min(2).max(100),
  contactEmail: z.email().max(254),
  maxUsers: z.number().int().min(1).max(10_000),
  status: z.enum(['ACTIVE', 'BLOCKED']).optional(),
  website: z.url().optional(),
});
const loginBody = z.strictObject({
  username: z.string().min(1).max(254),
  password: z.string().min(1).max(128),
});
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});
const termQuery = pageQuery.extend({ language: z.enum(LANGUAGES).optional() });
const idParam = z.uuid();

// ---------------------------------------------------------------------------- http helpers

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

function send(
  ctx: Ctx,
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
): void {
  ctx.res.writeHead(status, {
    ...SECURITY_HEADERS,
    'x-correlation-id': ctx.correlationId,
    ...(body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
    ...headers,
  });
  ctx.res.end(body === undefined ? undefined : JSON.stringify(body));
}

function metadata(ctx: Ctx, pagination?: object): object {
  return {
    correlationId: ctx.correlationId,
    timestamp: now(),
    ...(pagination ? { pagination } : {}),
  };
}

function ok(ctx: Ctx, status: number, data: unknown, pagination?: object): void {
  send(ctx, status, { success: true, message: 'OK', data, metadata: metadata(ctx, pagination) });
}

function fail(ctx: Ctx, error: HttpError): void {
  send(
    ctx,
    error.status,
    {
      success: false,
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.errors ? { errors: error.errors } : {}),
      metadata: metadata(ctx),
    },
    error.headers,
  );
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES)
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', {
    errors: result.error.issues.map((issue) => ({
      field: issue.path.join('.') || undefined,
      message: issue.message,
    })),
  });
}

function authenticate(ctx: Ctx, roles: readonly Role[]): Claims {
  const match = /^Bearer ([\w\-.]+)$/.exec(ctx.req.headers.authorization ?? '');
  if (!match?.[1]) throw new HttpError(401, 'UNAUTHORIZED', 'Missing or malformed credentials');
  const claims = verifyToken(match[1]);
  if (claims === 'expired') throw new HttpError(401, 'UNAUTHORIZED', 'Token expired');
  const user = claims ? users.get(claims.sub) : undefined;
  if (!claims || !user || user.deletedAt) throw new HttpError(401, 'UNAUTHORIZED', 'Invalid token');
  if (!roles.includes(claims.role as Role))
    throw new HttpError(403, 'FORBIDDEN', 'Insufficient permissions');
  return claims;
}

function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): { data: T[]; pagination: object } {
  const totalItems = items.length;
  return {
    data: items.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) },
  };
}

const toUserDto = ({ passwordHash: _p, createdBy: _c, deletedAt: _d, ...dto }: User): object => dto;
const toCompanyDto = ({ createdBy: _c, ...company }: Company): object => ({
  ...company,
  isBlocked: company.status === 'BLOCKED',
});
const later = (previous: string): string =>
  new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();

function findUser(id: string | undefined, claims: Claims): User {
  const user = users.get(parse(idParam, id));
  if (!user || user.deletedAt) throw new HttpError(404, 'NOT_FOUND', 'User not found');
  if (claims.role === 'COMPANY_ADMIN' && user.companyId !== claims.tenantId)
    throw new HttpError(403, 'FORBIDDEN', 'User belongs to another company');
  return user;
}

function assertAssignableBy(claims: Claims, role: Role): void {
  if (claims.role === 'COMPANY_ADMIN' && !['USER', 'COMPANY_ADMIN'].includes(role)) {
    throw new HttpError(403, 'FORBIDDEN', 'Not allowed to assign this role');
  }
}

// ---------------------------------------------------------------------------- routes

export type Handler = (ctx: Ctx, params: Record<string, string>) => void | Promise<void>;
export interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

/** What a route module needs from the server, passed in so there is no import cycle. */
export type HttpErrorLike = HttpError;
export interface MockHelpers {
  send: typeof send;
  readJson: typeof readJson;
  HttpError: typeof HttpError;
}

const routes: Route[] = [
  ...kpostCommonRoutes({ send, readJson, HttpError }),
  { method: 'GET', pattern: /^\/health$/, handler: (ctx) => ok(ctx, 200, { status: 'UP' }) },

  {
    method: 'POST',
    pattern: /^\/auth\/login$/,
    handler: async (ctx) => {
      const body = parse(loginBody, await readJson(ctx.req));
      const key = body.username.toLowerCase();
      const recent = (loginFailures.get(key) ?? []).filter(
        (t) => Date.now() - t < LOGIN_FAILURE_WINDOW_MS,
      );
      if (recent.length >= LOGIN_FAILURE_LIMIT) {
        throw new HttpError(429, 'RATE_LIMITED', 'Too many failed login attempts', {
          headers: { 'retry-after': String(Math.ceil(LOGIN_FAILURE_WINDOW_MS / 1000)) },
        });
      }
      const user = [...users.values()].find((u) => u.email.toLowerCase() === key && !u.deletedAt);
      if (!user?.passwordHash || user.passwordHash !== hashPassword(body.password)) {
        loginFailures.set(key, [...recent, Date.now()]);
        throw new HttpError(401, 'UNAUTHORIZED', 'Invalid credentials');
      }
      const iat = Math.floor(Date.now() / 1000);
      const tenantId = ['COMPANY_ADMIN', 'USER'].includes(user.role) ? user.companyId : undefined;
      const accessToken = signToken({
        sub: user.id,
        role: user.role,
        tenantId,
        iat,
        exp: iat + TOKEN_TTL_SECONDS,
        iss: 'kpost-mock',
      });
      ok(ctx, 200, { accessToken, tokenType: 'Bearer', expiresIn: TOKEN_TTL_SECONDS });
    },
  },

  {
    method: 'GET',
    pattern: /^\/users$/,
    handler: (ctx) => {
      const claims = authenticate(ctx, USER_MANAGERS);
      const { page, pageSize } = parse(pageQuery, Object.fromEntries(ctx.url.searchParams));
      const visible = [...users.values()]
        .filter(
          (u) =>
            !u.deletedAt && (claims.role !== 'COMPANY_ADMIN' || u.companyId === claims.tenantId),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const { data, pagination } = paginate(visible, page, pageSize);
      ok(ctx, 200, data.map(toUserDto), pagination);
    },
  },

  {
    method: 'POST',
    pattern: /^\/users$/,
    handler: async (ctx) => {
      const claims = authenticate(ctx, USER_MANAGERS);
      const body = parse(createUserBody, await readJson(ctx.req));
      if (claims.role === 'COMPANY_ADMIN' && body.companyId !== claims.tenantId) {
        throw new HttpError(403, 'FORBIDDEN', 'Cannot create users in another company');
      }
      assertAssignableBy(claims, body.role);
      const company = companies.get(body.companyId);
      if (!company) throw new HttpError(422, 'COMPANY_NOT_FOUND', 'Company does not exist');
      if (company.status === 'BLOCKED')
        throw new HttpError(422, 'COMPANY_BLOCKED', 'Company is blocked');
      const active = [...users.values()].filter((u) => !u.deletedAt);
      if (active.some((u) => u.email.toLowerCase() === body.email.toLowerCase())) {
        throw new HttpError(409, 'DUPLICATE_USER', 'A user with this e-mail already exists');
      }
      if (active.filter((u) => u.companyId === company.id).length >= company.maxUsers) {
        throw new HttpError(
          409,
          'COMPANY_USER_LIMIT_REACHED',
          'Company user licence limit reached',
        );
      }
      const timestamp = now();
      const user: User = {
        id: randomUUID(),
        email: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        role: body.role,
        companyId: body.companyId,
        phone: body.phone ?? null,
        profile: body.profile
          ? { title: body.profile.title, website: body.profile.website ?? null }
          : null,
        specialityIds: body.specialityIds ?? [],
        isActive: true,
        passwordHash: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: claims.sub,
        deletedAt: null,
      };
      users.set(user.id, user);
      ok(ctx, 201, toUserDto(user));
    },
  },

  {
    method: 'GET',
    pattern: /^\/users\/(?<id>[^/]+)$/,
    handler: (ctx, { id }) =>
      ok(ctx, 200, toUserDto(findUser(id, authenticate(ctx, USER_MANAGERS)))),
  },

  {
    method: 'PUT',
    pattern: /^\/users\/(?<id>[^/]+)$/,
    handler: async (ctx, { id }) => {
      const claims = authenticate(ctx, USER_MANAGERS);
      const user = findUser(id, claims);
      const body = parse(updateUserBody, await readJson(ctx.req));
      assertAssignableBy(claims, body.role);
      Object.assign(user, {
        ...body,
        phone: body.phone ?? user.phone,
        updatedAt: later(user.createdAt),
      });
      ok(ctx, 200, toUserDto(user));
    },
  },

  {
    method: 'DELETE',
    pattern: /^\/users\/(?<id>[^/]+)$/,
    handler: (ctx, { id }) => {
      const user = findUser(id, authenticate(ctx, USER_MANAGERS));
      Object.assign(user, { deletedAt: now(), isActive: false, updatedAt: later(user.createdAt) });
      send(ctx, 204);
    },
  },

  {
    method: 'POST',
    pattern: /^\/companies$/,
    handler: async (ctx) => {
      const claims = authenticate(ctx, PLATFORM_ADMINS);
      const body = parse(createCompanyBody, await readJson(ctx.req));
      if ([...companies.values()].some((c) => c.name.toLowerCase() === body.name.toLowerCase())) {
        throw new HttpError(409, 'DUPLICATE_COMPANY', 'A company with this name already exists');
      }
      const timestamp = now();
      const company: Company = {
        id: randomUUID(),
        name: body.name,
        contactEmail: body.contactEmail,
        maxUsers: body.maxUsers,
        status: body.status ?? 'ACTIVE',
        website: body.website ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: claims.sub,
      };
      companies.set(company.id, company);
      ok(ctx, 201, toCompanyDto(company));
    },
  },

  {
    method: 'GET',
    pattern: /^\/dictionary\/terms$/,
    handler: (ctx) => {
      authenticate(ctx, ALL_ROLES);
      const { page, pageSize, language } = parse(
        termQuery,
        Object.fromEntries(ctx.url.searchParams),
      );
      const { data, pagination } = paginate(
        terms.filter((t) => !language || t.language === language),
        page,
        pageSize,
      );
      ok(ctx, 200, data, pagination);
    },
  },

  // ---- test-only routes (never part of the real API)
  {
    method: 'GET',
    pattern: /^\/__test\/db\/(?<table>users|companies)$/,
    handler: (ctx, { table }) => {
      const rows: object[] = table === 'users' ? [...users.values()] : [...companies.values()];
      const filters = [...ctx.url.searchParams.entries()];
      const matches = rows.filter((row) =>
        filters.every(([k, v]) => String((row as Record<string, unknown>)[k]) === v),
      );
      send(ctx, 200, { rows: matches });
    },
  },
  {
    method: 'GET',
    pattern: /^\/__test\/tokens\/expired$/,
    handler: (ctx) => {
      const iat = Math.floor(Date.now() / 1000) - 2 * TOKEN_TTL_SECONDS;
      ok(ctx, 200, {
        token: signToken({
          sub: 'expired-user',
          role: 'ADMIN',
          iat,
          exp: iat + TOKEN_TTL_SECONDS,
          iss: 'kpost-mock',
        }),
      });
    },
  },
  {
    method: 'GET',
    pattern: /^\/__test\/plain-text$/,
    handler: (ctx) => {
      ctx.res.writeHead(200, {
        ...SECURITY_HEADERS,
        'content-type': 'text/plain',
        'x-correlation-id': ctx.correlationId,
      });
      ctx.res.end('OK');
    },
  },
];

// ---------------------------------------------------------------------------- server

function decodeParams(params: Record<string, string>): Record<string, string> {
  try {
    return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, decodeURIComponent(v)]));
  } catch {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Malformed path parameter');
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const header = req.headers['x-correlation-id'];
  const ctx: Ctx = {
    req,
    res,
    url,
    correlationId: (Array.isArray(header) ? header[0] : header) ?? `mock-${randomUUID()}`,
  };
  try {
    const candidates = routes.filter((route) => route.pattern.test(url.pathname));
    if (!candidates.length) throw new HttpError(404, 'NOT_FOUND', 'Resource not found');
    const route = candidates.find((candidate) => candidate.method === req.method);
    if (!route) {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed', {
        headers: { allow: candidates.map((c) => c.method).join(', ') },
      });
    }
    await route.handler(ctx, decodeParams(route.pattern.exec(url.pathname)?.groups ?? {}));
  } catch (error) {
    if (error instanceof HttpError) {
      fail(ctx, error);
      return;
    }
    console.error(`[mock-api] ${ctx.correlationId}`, error);
    fail(ctx, new HttpError(500, 'INTERNAL_ERROR', 'An unexpected error occurred'));
  }
}

const server = createServer((req, res) => void handle(req, res));
server.listen(PORT, '127.0.0.1', () =>
  console.log(`Mock KPost API listening on http://127.0.0.1:${PORT}`),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
