import { randomUUID } from 'node:crypto';

export interface UserData {
  username: string;
  email: string;
  password: string;
}

const uniqueSuffix = (): string => randomUUID().slice(0, 8);

/** Unique per call so parallel workers never collide on test data. */
export function buildUser(overrides: Partial<UserData> = {}): UserData {
  const id = uniqueSuffix();
  return {
    username: `qa_${id}`,
    email: `qa+${id}@example.test`,
    password: `Pw!${randomUUID()}`,
    ...overrides,
  };
}

/** Valid `POST /users` payload (unique e-mail) for the given company. */
export function buildUserPayload(companyId: string): Record<string, unknown> {
  const id = uniqueSuffix();
  return {
    email: `qa.user+${id}@kpost.test`,
    firstName: 'Quinn',
    lastName: `Tester-${id}`,
    role: 'USER',
    companyId,
    phone: '+4915112345678',
    profile: { title: 'Radiologist', website: `https://kpost.test/profiles/${id}` },
    specialityIds: [randomUUID()],
  };
}

/** Valid `POST /companies` payload with a unique name. */
export function buildCompanyPayload(): Record<string, unknown> {
  const id = uniqueSuffix();
  return {
    name: `QA Company ${id}`,
    contactEmail: `qa.company+${id}@kpost.test`,
    maxUsers: 50,
    website: `https://kpost.test/companies/${id}`,
  };
}
