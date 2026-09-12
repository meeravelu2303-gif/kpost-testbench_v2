import { z } from 'zod';
import { ROLES } from '@config/auth.config';

/** Roles that may be assigned through the API (SUPER_ADMIN is provisioned out of band). */
export const ASSIGNABLE_ROLES = ['ADMIN', 'COMPANY_ADMIN', 'USER'] as const;

const personName = z.string().min(1).max(50);
const phone = z.string().regex(/^\+[1-9]\d{7,14}$/, 'E.164 phone number');

export const createUserRequestSchema = z.strictObject({
  email: z.email().max(254),
  firstName: personName,
  lastName: personName,
  role: z.enum(ASSIGNABLE_ROLES),
  companyId: z.uuid(),
  phone: phone.optional(),
  profile: z
    .strictObject({ title: z.string().min(1).max(100), website: z.url().optional() })
    .optional(),
  specialityIds: z.array(z.uuid()).max(5).optional(),
});

export const updateUserRequestSchema = z.strictObject({
  firstName: personName,
  lastName: personName,
  role: z.enum(ASSIGNABLE_ROLES),
  phone: phone.optional(),
});

export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  firstName: z.string(),
  lastName: z.string(),
  role: z.enum(ROLES),
  companyId: z.uuid(),
  phone: z.string().nullable(),
  profile: z.object({ title: z.string(), website: z.url().nullable() }).nullable(),
  specialityIds: z.array(z.uuid()),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const userListSchema = z.array(userSchema);
export const userIdParamsSchema = z.object({ id: z.uuid() });
export const listUsersQuerySchema = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});
