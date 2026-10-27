import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import { awsApis } from '@api/definitions/kpost/aws/index';
import { commonApis } from '@api/definitions/kpost/common/index';
import { contactsApis } from '@api/definitions/kpost/contacts/index';
import { dashboardApis } from '@api/definitions/kpost/dashboard/index';
import { groupApis } from '@api/definitions/kpost/group/index';
import { kallApis } from '@api/definitions/kpost/kall/index';
import { katchupApis } from '@api/definitions/kpost/katchup/index';
import { kbookingApis } from '@api/definitions/kpost/kbooking/index';
import { kdiaryApis } from '@api/definitions/kpost/kdiary/index';
import { profileApis } from '@api/definitions/kpost/profile/index';
import { settingsApis } from '@api/definitions/kpost/settings/index';
import { signupLoginApis } from '@api/definitions/kpost/signup-login/index';
import { adminUserManagementApis } from '@api/definitions/kpost/admin/user-management.api';
import { kmailApis } from '@api/definitions/kmail';
import { TAGS } from '@config/constants';
import { describeEndpointCases } from '@engine/endpoint-cases';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { test } from '@fixtures';

/**
 * Sanity read sweep: every productionSafe, non-OTP read of each in-scope module at the SMOKE profile,
 * one test per endpoint × check. Tagged @sanity-sweep, not @regression: the module specs already run
 * these at the FULL profile.
 */
const liveReads = (apis: readonly EndpointDefinition[]): string[] =>
  apis.filter((api) => api.productionSafe === true && !api.otpDependent).map((api) => api.id);

const SWEEPS: ReadonlyArray<{ title: string; tag: string; apis: readonly EndpointDefinition[] }> = [
  { title: 'Signup & Login', tag: TAGS.auth, apis: signupLoginApis },
  { title: 'Katchup', tag: TAGS.katchup, apis: katchupApis },
  { title: 'Group', tag: TAGS.group, apis: groupApis },
  { title: 'Kall', tag: TAGS.kall, apis: kallApis },
  { title: 'Contacts', tag: TAGS.contacts, apis: contactsApis },
  { title: 'Profile', tag: TAGS.profile, apis: profileApis },
  { title: 'Settings', tag: TAGS.settings, apis: settingsApis },
  { title: 'Home dashboard', tag: TAGS.home, apis: dashboardApis },
  { title: 'User Management (business)', tag: TAGS.userManagement, apis: adminUserManagementApis },
  {
    title: 'Verticals (KDiary, KBooking)',
    tag: TAGS.verticals,
    apis: [...kdiaryApis, ...kbookingApis],
  },
  { title: 'Platform (common, AWS)', tag: TAGS.platform, apis: [...commonApis, ...awsApis] },
];

for (const sweep of SWEEPS) {
  test.describe(
    `SANITY · API reads · ${sweep.title}`,
    { tag: [TAGS.api, sweep.tag, TAGS.sanity, TAGS.sanitySweep] },
    () => {
      const ids = liveReads(sweep.apis);
      // An empty sweep (e.g. Group, whose reads all need a group id) is a skip, not a failure.
      describeEndpointCases({ ids }, { profile: 'SMOKE', allowEmpty: true });
    },
  );
}

test.describe(
  'SANITY · API reads · KMail',
  { tag: [TAGS.api, TAGS.kmail, TAGS.sanity, TAGS.sanitySweep] },
  () => {
    // Same gate as every KMail spec, so a refused token is not re-reported per endpoint.
    test.skip(kmailAuthGate() !== undefined, kmailAuthGate() ?? '');
    describeEndpointCases({ ids: liveReads(kmailApis) }, { profile: 'SMOKE', allowEmpty: true });
  },
);
