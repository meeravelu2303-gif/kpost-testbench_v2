import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { expect, test } from '@fixtures';
import { COMPANY_ADMIN, COMPANY_ID, planThrowawayMember } from '../../support/company-member';

/**
 * Who may change a company member: only that company's admin. A throwaway member of company 242 is
 * created by its admin; then a personal user (qatest3) and the admin of ANOTHER company (1034) each
 * try the admin writes on it (make it backup admin, change its role, hold it, terminate it), and a
 * personal user tries to add a member to 242. Each must be refused and leave the member exactly as
 * it was (checked in the QA DB). The member is terminated afterwards. QA server only.
 */
const K = AUTH_PROFILES.kpost;
const OUTSIDERS: Array<[string, Principal | undefined]> = [
  ['a personal user', K.principals.find((p) => p.key === 'personal-3')],
  ['the admin of another company (1034)', K.principals.find((p) => p.key === 'business-s')],
];

type MemberState = {
  active_status?: string;
  is_backup_admin?: number;
  role?: string | null;
};

test.describe('KPost Admin · only the company admin can change its members @api @security', () => {
  test.skip(
    process.env.GLOBAL_LIFECYCLE !== 'true' || process.env.TEST_DB_MODE !== 'true',
    'creates a company member and tries admin writes on it; set GLOBAL_LIFECYCLE=true and TEST_DB_MODE=true',
  );
  test.skip(
    OUTSIDERS.some(([, p]) => !p),
    'needs provisioned qatest3 and the QA_BUSINESS_S admin',
  );

  test('a personal user and another company’s admin are refused, and the member is unchanged', async ({
    endpoints,
    databases,
  }) => {
    const member = await planThrowawayMember(endpoints, 'admin-authz');
    const intruderKpostID = `qa-bench-intruder-${Date.now()}.${member.kpostID.split('.').slice(1).join('.')}`;
    const intruderMobile = `97${member.mobile.slice(2)}`;
    const owned = [member.kpostID, member.mobile, intruderKpostID, intruderMobile];
    const send = (id: string, body: Record<string, unknown>, as: Principal, label: string) =>
      endpoints.sendTo(
        id,
        { body },
        {
          label: `admin-authz:${label}`,
          auth: { principal: as },
          allowGlobalLifecycle: true,
          ownedIdentifiers: owned,
        },
      );

    const db = databases.for('kpost-api');
    const stateOf = async (kpostID: string): Promise<MemberState> => {
      if (!db.enabled) return {};
      const user = await db.findOne<{ active_status: string; is_backup_admin: number | null }>({
        table: 'TBL_KPOST_USER_MASTER',
        where: { kpost_id: kpostID },
      });
      const profile = await db.findOne<{ role: string | null }>({
        table: 'TBL_KPOST_USER_PROFILE',
        where: { kpost_id: kpostID },
      });
      return {
        active_status: user?.active_status,
        is_backup_admin: Number(user?.is_backup_admin ?? 0),
        role: profile?.role ?? null,
      };
    };

    let created = false;
    let intruderCreated = false;
    try {
      const create = await send('admin-adding-user-by-admin', member.body, COMPANY_ADMIN, 'create');
      expect(create.status, 'the company admin creates the member (setup)').toBe(200);
      created = true;
      const before = await stateOf(member.kpostID);

      const attempts: Array<[string, Record<string, unknown>, string]> = [
        [
          'admin-create-remove-backup-admin',
          { kpostID: member.kpostID, isBackUpAdmin: true, companyID: COMPANY_ID },
          'make it backup admin',
        ],
        [
          'admin-update-role',
          { kpostID: member.kpostID, role: 'QA Escalation', companyID: COMPANY_ID },
          'change its role',
        ],
        [
          'admin-hold-or-release',
          { kpostID: member.kpostID, activeStatus: 'No', companyID: COMPANY_ID },
          'hold it',
        ],
        [
          'admin-terminate-user',
          { kpostID: member.kpostID, companyID: COMPANY_ID },
          'terminate it',
        ],
      ];
      for (const [who, outsider] of OUTSIDERS) {
        for (const [id, body, what] of attempts) {
          const res = await send(id, body, outsider!, `${who}:${what}`);
          const accepted = res.status < 300 && /"status"\s*:\s*"SUCCESS"/i.test(res.bodyText ?? '');
          if (accepted) {
            endpoints.recordBusinessRuleViolation({
              endpointId: id,
              ruleId: `ADMIN-AUTHZ-${id}-by-${outsider!.key}`,
              rule: `Only company 242's admin may ${what} for a member of company 242; ${who} must be refused.`,
              expected: 'a 4xx refusal and the member unchanged',
              actual: `${id} answered ${res.status} SUCCESS for ${who}`,
              request: { body: { ...body, kpostID: '(throwaway member)' } },
            });
          }
          expect.soft(accepted, `${who} cannot ${what}`).toBe(false);
          expect
            .soft(res.status, `${who}: ${what} is refused with a 4xx`)
            .toBeGreaterThanOrEqual(400);
          expect
            .soft(
              await stateOf(member.kpostID),
              `the member is unchanged after ${who} tried to ${what}`,
            )
            .toEqual(before);
        }
      }

      // A personal user adding a member to company 242.
      const [, personal] = OUTSIDERS[0]!;
      const intruder = await send(
        'admin-adding-user-by-admin',
        {
          ...member.body,
          kpostID: intruderKpostID,
          mobileNumber: intruderMobile,
          referenceName: 'QA Intruder',
        },
        personal!,
        'personal:add-member',
      );
      intruderCreated = intruder.status < 300;
      expect
        .soft(intruder.status, 'a personal user cannot add a member to a company')
        .toBeGreaterThanOrEqual(400);
    } finally {
      for (const [made, kpostID] of [
        [created, member.kpostID],
        [intruderCreated, intruderKpostID],
      ] as const) {
        if (!made) continue;
        const ended = await send(
          'admin-terminate-user',
          { kpostID, companyID: COMPANY_ID },
          COMPANY_ADMIN,
          'cleanup',
        ).catch(() => undefined);
        expect
          .soft(ended?.status, `the throwaway ${kpostID} is terminated (nothing left behind)`)
          .toBe(200);
      }
    }
  });
});
