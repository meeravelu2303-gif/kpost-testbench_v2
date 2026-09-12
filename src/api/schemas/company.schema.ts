import { z } from 'zod';

export const COMPANY_STATUSES = ['ACTIVE', 'BLOCKED'] as const;

export const createCompanyRequestSchema = z.strictObject({
  name: z.string().min(2).max(100),
  contactEmail: z.email().max(254),
  maxUsers: z.number().int().min(1).max(10_000),
  status: z.enum(COMPANY_STATUSES).optional(),
  website: z.url().optional(),
});

export const companySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  contactEmail: z.email(),
  maxUsers: z.number().int(),
  status: z.enum(COMPANY_STATUSES),
  website: z.url().nullable(),
  isBlocked: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
