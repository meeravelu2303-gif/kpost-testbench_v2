import type { JsonObject } from '@utils/json';
import type { DatabaseClient } from '../database-client';

export interface UserRecord extends JsonObject {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  companyId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  deletedAt: string | null;
}

export class UserRepository {
  constructor(private readonly db: DatabaseClient) {}

  findById(id: string, correlationId?: string): Promise<UserRecord | undefined> {
    return this.db.findOne<UserRecord>({ table: 'users', where: { id } }, correlationId);
  }
}
