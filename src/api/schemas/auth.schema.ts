import { z } from 'zod';

export const loginRequestSchema = z.strictObject({
  username: z.string().min(1).max(254),
  password: z.string().min(1).max(128),
});

export const loginResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
});

export const healthSchema = z.object({ status: z.literal('UP') });
