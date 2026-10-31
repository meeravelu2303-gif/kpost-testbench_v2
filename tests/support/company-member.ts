import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';

/**
 * A throwaway member of QA company 242 (QA_BUSINESS_M), minted by its company admin the way the web's
 * User Management › Add Manually does (UserManagement.js addingUserToChannel), for flows that need a
 * company member to act on. Shared-state writes: the QA server only (GLOBAL_LIFECYCLE + TEST_DB_MODE).
 */
export const COMPANY_ADMIN: Principal = AUTH_PROFILES.kpost.principals.find(
  (p) => p.key === 'business-m',
)!;
export const COMPANY_ID = String(testData.businessMCompanyId);

interface AdminProfile {
  countryID?: number;
  countryCode?: string;
  userProfile?: { country?: string; state?: string; companyName?: string };
}

/** `admin.contactID.replace(/^[^.]*\./, '')` — strip up to and including the admin's own first `.`. */
export function domainFrom(adminKpostId: string): string {
  return adminKpostId.includes('@') ? adminKpostId.replace(/^[^.]*\./, '') : adminKpostId;
}

/** A 10-digit Indian mobile, [6-9]-led, deliberately NOT in this bench's `9000000xxx` sentinel family. */
export function throwawayMobile(): string {
  const suffix = String(Date.now()).slice(-6);
  return `98${suffix}0`.padEnd(10, '1').slice(0, 10);
}

export interface ThrowawayMember {
  kpostID: string;
  mobile: string;
  /** The web's Add Manually body for this member. */
  body: Record<string, unknown>;
}

/** The member's kpostID, mobile and Add Manually body, from the admin's own profile fields. */
export async function planThrowawayMember(
  endpoints: EndpointExecutor,
  label: string,
): Promise<ThrowawayMember> {
  const adminProfile = await endpoints.sendTo(
    'profile-user-profile-by-kpostid',
    { body: { kpostID: testData.businessMKpostId } },
    { label: `${label}:admin-profile`, auth: { principal: COMPANY_ADMIN }, allowLiveRead: true },
  );
  if (adminProfile.status !== 200)
    throw new Error(`the company admin's profile could not be read (${adminProfile.status})`);
  const admin = (JSON.parse(adminProfile.bodyText ?? '{}') as { data?: AdminProfile }).data ?? {};
  const kpostID = `qa-bench-throwaway-${Date.now()}.${domainFrom(testData.businessMKpostId)}`;
  const mobile = throwawayMobile();
  return {
    kpostID,
    mobile,
    body: {
      companyID: COMPANY_ID,
      companyName: admin.userProfile?.companyName ?? testData.companyName,
      firstName: 'QA',
      lastName: 'Throwaway',
      mobileNumber: mobile,
      gender: 'male',
      countryID: admin.countryID ?? testData.countryId,
      countryCode: admin.countryCode ?? '91',
      userType: 'BUSINESS_M',
      language: 'english',
      country: admin.userProfile?.country ?? 'India',
      designation: 'QA Tester',
      role: null,
      state: admin.userProfile?.state ?? 'Tamil Nadu',
      referenceName: 'QA Throwaway',
      activeStatus: 'yes',
      kpostID,
      requestType: 'newUser',
    },
  };
}
