import { AUTH_PROFILES } from '@config/auth-profile';
import { isSqlClient } from '@database/database-client';
import { expect, test } from '@fixtures';

/**
 * Profile saves must ignore fields a user may not set: account type, company, active status,
 * backup-admin flag, mobile, e-mail, name, access code, or another account's KPost ID. Checked on the
 * 4th QA account (and the 2nd, whose id is slipped in) against the DB; every column the saves change
 * is put back from a snapshot, so the account ends exactly as it started.
 */
const K = AUTH_PROFILES.kpost;
const OWNER = K.principals.find((p) => p.key === 'personal-4');
const OTHER = K.principals.find((p) => p.key === 'victim');
const TABLES = ['TBL_KPOST_USER_MASTER', 'TBL_KPOST_USER_PROFILE'] as const;
/** Columns a profile save must never change, whatever the body says. */
const PROTECTED =
  /^(user_type|company_id|companyid|active_status|is_back_up_admin|is_backup_admin|mobile_number|email|first_name|last_name|access_code|kpost_id|password)$/i;
const VOLATILE = /modified|updated|last_login|login_time|logout/i;

type Row = Record<string, unknown>;
type Snapshot = Record<string, Record<string, Row>>;

test.describe(
  'KPost Profile · saves ignore fields the user may not set @api @kpost-api @profile @security @database',
  {
    tag: ['@api', '@profile', '@regression'],
    annotation: [{ type: 'non-functional', description: 'security' }],
  },
  () => {
    test.skip(!OWNER?.username || !OTHER?.username, 'needs the 2nd and 4th QA accounts');

    test('extra account fields in basic and contact saves change nothing protected', async ({
      endpoints,
      databases,
    }) => {
      const db = databases.for('kpost-api');
      test.skip(
        !isSqlClient(db) || !db.writable,
        'needs the writable KPOST_QA connection to put the account back',
      );
      if (!isSqlClient(db)) return;
      const ids = [OWNER!.username, OTHER!.username];
      const snapshot = async (): Promise<Snapshot> => {
        const out: Snapshot = {};
        for (const table of TABLES) {
          const rows = await db.query<Row>(`SELECT * FROM ${table} WHERE kpost_id IN (?, ?)`, ids);
          out[table] = Object.fromEntries(rows.map((r) => [String(r.kpost_id), r]));
        }
        return out;
      };
      const changes = (a: Snapshot, b: Snapshot) =>
        TABLES.flatMap((table) =>
          ids.flatMap((who) => {
            const x = a[table]?.[who] ?? {};
            const y = b[table]?.[who] ?? {};
            return Object.keys({ ...x, ...y })
              .filter((col) => !VOLATILE.test(col))
              .filter((col) => JSON.stringify(x[col]) !== JSON.stringify(y[col]))
              .map((col) => ({ table, who, col, before: x[col] }));
          }),
        );

      const before = await snapshot();
      const extras = {
        userType: 'BUSINESS_L',
        companyID: 242,
        activeStatus: 'No',
        isBackUpAdmin: true,
        mobileNumber: '9000000999',
        email: 'qa.mass.assign@example.com',
        firstName: 'QAMass',
        lastName: 'Assign',
        kpostID: OTHER!.username,
        accessCode: '9999',
        role: 'ADMIN',
      };
      try {
        await endpoints.sendTo(
          'profile-update-basic',
          {
            body: {
              knownLanguages: ['English'],
              designation: 'QA Bench Tester',
              gender: 'Female',
              dateOfBirth: '1995-01-01',
              ...extras,
            },
          },
          { label: 'mass-assign:basic', auth: { principal: OWNER! }, allowLiveWrite: true },
        );
        await endpoints.sendTo(
          'profile-update-contact',
          {
            body: {
              country: 'INDIA',
              pinCode: '600001',
              city: 'Chennai',
              areaName: 'QA Bench',
              addressLine1: 'QA Bench Address',
              ...extras,
            },
          },
          { label: 'mass-assign:contact', auth: { principal: OWNER! }, allowLiveWrite: true },
        );
        const changed = changes(before, await snapshot());
        const forbidden = changed
          .filter((c) => PROTECTED.test(c.col) || c.who !== OWNER!.username)
          .map((c) => `${c.who} ${c.table}.${c.col}`);
        expect
          .soft(forbidden, 'no protected column (and nothing of the other account) changes')
          .toEqual([]);
      } finally {
        // Put back every column the saves changed, from the snapshot.
        for (const c of changes(before, await snapshot())) {
          if (!/^[a-z0-9_]+$/i.test(c.col)) continue;
          await db.query(`UPDATE ${c.table} SET \`${c.col}\` = ? WHERE kpost_id = ?`, [
            c.before as never,
            c.who,
          ]);
        }
      }
    });
  },
);
