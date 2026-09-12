import type { JsonObject } from '@utils/json';
import type { DatabaseClient } from '../database-client';

export interface CompanyRecord extends JsonObject {
  id: string;
  name: string;
  contactEmail: string;
  maxUsers: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export class CompanyRepository {
  constructor(private readonly db: DatabaseClient) {}

  findById(id: string, correlationId?: string): Promise<CompanyRecord | undefined> {
    return this.db.findOne<CompanyRecord>({ table: 'companies', where: { id } }, correlationId);
  }
}
