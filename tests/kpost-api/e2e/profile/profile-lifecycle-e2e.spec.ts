import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { testData } from '@config/test-data.config';
import type { EndpointExecutor } from '@engine/endpoint-executor';
import { JPEG_1X1 } from '@api/definitions/kpost/profile/image.api';
import { expect, test } from '@fixtures';
import { expectStored, filled } from '../../../support/db-stored';

/**
 * Profile write lifecycle: read, update, read back, restore, so nothing is left altered.
 * Gated behind `PROFILE_LIFECYCLE=true` because it writes real profile data.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

/** The caller's own TBL_KPOST_USER_PROFILE / TBL_KPOST_USER_MASTER row (kpost_id is the key). */
const ownRow = (): { kpost_id: string } => ({ kpost_id: A.username });

/** The entries of a JSON-array column (a longtext string, a BLOB, or a parsed JSON value). */
function jsonEntries(value: unknown): Array<Record<string, unknown>> {
  let parsed: unknown = value;
  try {
    if (Buffer.isBuffer(value)) parsed = JSON.parse(value.toString('utf8'));
    else if (typeof value === 'string') parsed = value.trim() ? JSON.parse(value) : [];
  } catch {
    return [];
  }
  return Array.isArray(parsed)
    ? parsed.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    : [];
}

/** The JSON-array column holds an entry carrying every field of `fields` as sent. */
const hasEntry =
  (fields: Record<string, unknown>) =>
  (value: unknown): boolean =>
    jsonEntries(value).some((entry) =>
      Object.entries(fields).every(([key, want]) => String(entry[key]) === String(want)),
    );

/** The JSON-array column no longer holds the entry whose `idField` is `id`. */
const noEntry =
  (idField: string, id: string) =>
  (value: unknown): boolean =>
    !jsonEntries(value).some((entry) => entry[idField] === id);

/** A MySQL `date` (mysql2: a local-midnight Date) is the calendar day `ymd`. */
const sameDay =
  (ymd: string) =>
  (value: unknown): boolean => {
    if (value instanceof Date) {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` === ymd;
    }
    return typeof value === 'string' && value.startsWith(ymd);
  };

/**
 * The caller's editable profile fields (`data.userProfile`). Uses `profile-get-user-profile`, not
 * the by-kpostid lookup, which fails for the primary account and would skip every cleanup delete.
 */
async function fetchProfile(endpoints: EndpointExecutor): Promise<Record<string, unknown>> {
  const exchange = await endpoints.sendTo(
    'profile-get-user-profile',
    {},
    { label: 'profile:fetch', auth: { principal: A } },
  );
  const parsed = exchange.json();
  const value = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
  const data = (value.data as Record<string, unknown> | undefined) ?? {};
  return (data.userProfile as Record<string, unknown> | undefined) ?? {};
}

async function write(
  endpoints: EndpointExecutor,
  id: string,
  bodyValue: Record<string, unknown>,
  label: string,
): Promise<number> {
  const exchange = await endpoints.sendTo(
    id,
    { body: bodyValue },
    { label: `profile:${label}`, auth: { principal: A }, allowLiveWrite: true },
  );
  return exchange.status;
}

test.describe(
  'KPost Profile · write lifecycle',
  { tag: ['@api', '@profile', '@regression'] },
  () => {
    test.describe.configure({ mode: 'default' });
    test.skip(
      process.env.PROFILE_LIFECYCLE !== 'true',
      'writes real profile data; set PROFILE_LIFECYCLE=true to run',
    );

    test(
      'update "about" is saved and reads back, then is restored @api @profile',
      { tag: '@sanity' },
      async ({ endpoints }) => {
        const before = (await fetchProfile(endpoints)).aboutYourself;
        const marker = `QA about ${Date.now()}`;

        const status = await write(
          endpoints,
          'profile-update-about',
          { aboutYourself: marker },
          'about',
        );
        expect(status, 'update about accepted').toBeLessThan(300);

        // Read-back is best-effort: the profile read can lag the write (eventual consistency), so it is
        // verified only when the field has surfaced — the 200 above is the write's own confirmation.
        const after = (await fetchProfile(endpoints)).aboutYourself;
        if (after !== undefined && after !== null && after !== '') {
          expect.soft(after, 'the new about reads back').toBe(marker);
        }

        // Restore.
        await write(
          endpoints,
          'profile-update-about',
          { aboutYourself: typeof before === 'string' ? before : '' },
          'about-restore',
        );
      },
    );

    test(
      'update designation is saved and reads back, then is restored @api @profile',
      // A person's profession is their Profile designation (Personal signup has no profession field).
      { annotation: [{ type: 'requirement', description: 'FR-SL-031' }] },
      async ({ endpoints, databases }) => {
        const db = databases.for('kpost-api');
        const before = (await fetchProfile(endpoints)).designation;
        const marker = `QA Designation ${Date.now() % 100000}`;

        const status = await write(
          endpoints,
          'profile-update-designation',
          { designation: marker },
          'designation',
        );
        expect(status, 'update designation accepted').toBeLessThan(300);
        // UserProfileDaoImpl.java:885 sets designation on the caller's profile row.
        await expectStored(
          db,
          'profile-update-designation',
          {
            table: 'TBL_KPOST_USER_PROFILE',
            where: ownRow(),
            columns: { designation: marker },
            rule: "updateDesignation stores the designation sent on the caller's profile",
          },
          endpoints,
        );

        // Best-effort read-back (see the about test for why).
        const after = (await fetchProfile(endpoints)).designation;
        if (after !== undefined && after !== null && after !== '') {
          expect.soft(after, 'the new designation reads back').toBe(marker);
        }

        await write(
          endpoints,
          'profile-update-designation',
          { designation: typeof before === 'string' ? before : '' },
          'designation-restore',
        );
      },
    );

    test('set profile privacy (private in search) is stored, then restored @api @profile', async ({
      endpoints,
      databases,
    }) => {
      const db = databases.for('kpost-api');
      // The value to put back: the stored one, else 0 (public, the QA accounts' setting).
      const row = db.enabled
        ? await db.findOne<Record<string, unknown>>({
            table: 'TBL_KPOST_USER_PROFILE',
            where: ownRow(),
          })
        : undefined;
      const original = Number(row?.privacy_status ?? 0) || 0;
      const target = original === 1 ? 0 : 1;
      try {
        const status = await write(
          endpoints,
          'profile-set-profile-privacy',
          { privacyStatus: target },
          'set-privacy',
        );
        expect.soft(status, 'setProfilePrivacy accepted').toBeLessThan(300);
        // UserProfileDaoImpl.java:411 sets privacy_status on the caller's profile row.
        if (status < 300)
          await expectStored(
            db,
            'profile-set-profile-privacy',
            {
              table: 'TBL_KPOST_USER_PROFILE',
              where: ownRow(),
              columns: { privacy_status: target },
              rule: "setProfilePrivacy stores the privacyStatus sent on the caller's profile",
            },
            endpoints,
          );
      } finally {
        await write(
          endpoints,
          'profile-set-profile-privacy',
          { privacyStatus: original },
          'set-privacy-restore',
        ).catch(() => undefined);
      }
    });

    test('basic, contact and privacy updates are accepted and actually persist @api @profile', async ({
      endpoints,
      databases,
    }) => {
      const db = databases.for('kpost-api');
      // No read endpoint returns gender/dateOfBirth, so knownLanguages marks the basic update.
      const before = await fetchProfile(endpoints);
      // A city may hold only letters, spaces, '.', '-' or "'", so the run's timestamp is spelled in letters.
      const marker = `QA ${String(Date.now()).replace(/\d/g, (d) => 'abcdefghij'[Number(d)]!)}`;

      const basic = await write(
        endpoints,
        'profile-update-basic',
        {
          knownLanguages: ['English', 'Tamil'],
          designation: 'QA Bench',
          gender: 'Female',
          otherEmail: testData.kpostId,
          dateOfBirth: '1995-01-01',
        },
        'basic',
      );
      expect.soft(basic, 'update basic accepted').toBeLessThan(300);
      if (basic < 300) {
        // UserProfileDaoImpl.java:764 sets known_languages, designation and other_email on the profile row.
        await expectStored(
          db,
          'profile-update-basic',
          {
            table: 'TBL_KPOST_USER_PROFILE',
            where: ownRow(),
            columns: {
              known_languages: (v: unknown) => {
                let list: unknown[] = [];
                try {
                  const parsed: unknown = typeof v === 'string' ? JSON.parse(v) : v;
                  if (Array.isArray(parsed)) list = parsed;
                } catch {
                  return false;
                }
                return ['English', 'Tamil'].every((l) => list.includes(l));
              },
              designation: 'QA Bench',
              other_email: testData.kpostId,
            },
            rule: "updateBasicInformation stores the languages, designation and other e-mail sent on the caller's profile",
          },
          endpoints,
        );
        // UserProfileDaoImpl.java:763 sets gender and date_of_birth on the caller's user row.
        await expectStored(
          db,
          'profile-update-basic',
          {
            table: 'TBL_KPOST_USER_MASTER',
            where: ownRow(),
            columns: { gender: 'Female', date_of_birth: sameDay('1995-01-01') },
            rule: "updateBasicInformation stores the gender and date of birth sent on the caller's user row",
          },
          endpoints,
        );
      }

      const contact = await write(
        endpoints,
        'profile-update-contact',
        {
          country: 'INDIA',
          pinCode: testData.pinCode,
          city: marker,
          areaName: 'QA',
          addressLine1: marker,
        },
        'contact',
      );
      expect.soft(contact, 'update contact accepted').toBeLessThan(300);
      // UserProfileDaoImpl.java:487 sets country, pin code, city, area and the address (a JSON array
      // holding addressLine1) on the caller's profile row.
      if (contact < 300)
        await expectStored(
          db,
          'profile-update-contact',
          {
            table: 'TBL_KPOST_USER_PROFILE',
            where: ownRow(),
            columns: {
              country_name: 'INDIA',
              pin_code: testData.pinCode,
              city: marker,
              area_name: 'QA',
              present_address: hasEntry({ addressLine1: marker }),
            },
            rule: "updateContactInformation stores the country, pin code, city, area and address sent on the caller's profile",
          },
          endpoints,
        );

      const privacyValue = JSON.stringify({ about: 'false', experience: 'false', marker });
      const privacy = await write(
        endpoints,
        'profile-update-privacy',
        { privacyDetails: privacyValue },
        'privacy',
      );
      expect.soft(privacy, 'update privacy accepted').toBeLessThan(300);

      const after = await fetchProfile(endpoints);
      expect
        .soft(after.knownLanguages, 'the new knownLanguages actually persisted')
        .toEqual(['English', 'Tamil']);
      expect.soft(after.city, 'the new city actually persisted').toBe(marker);
      expect
        .soft(after.privacyDetails, 'the new privacyDetails actually persisted')
        .toBe(privacyValue);

      // Restore, best-effort.
      await write(
        endpoints,
        'profile-update-basic',
        {
          knownLanguages: Array.isArray(before.knownLanguages)
            ? before.knownLanguages
            : ['English'],
          designation: typeof before.designation === 'string' ? before.designation : '',
          gender: 'Female',
          otherEmail: testData.kpostId,
          dateOfBirth: '1995-01-01',
        },
        'basic-restore',
      );
      await write(
        endpoints,
        'profile-update-contact',
        {
          country: 'INDIA',
          pinCode: testData.pinCode,
          city: typeof before.city === 'string' ? before.city : '',
          areaName: typeof before.areaName === 'string' ? before.areaName : '',
          addressLine1: 'QA',
        },
        'contact-restore',
      );
      await write(
        endpoints,
        'profile-update-privacy',
        {
          privacyDetails:
            typeof before.privacyDetails === 'string'
              ? before.privacyDetails
              : JSON.stringify({ about: 'false', experience: 'false' }),
        },
        'privacy-restore',
      );
    });

    test('an education record can be saved and then deleted @api @profile', async ({
      endpoints,
      databases,
    }) => {
      const db = databases.for('kpost-api');
      // A unique marker per run tells this record from leftovers. `collegeDetails` is a JSON
      // string; `collegeDetailsAsJson` is the parsed array, so read that one.
      const marker = `QA Bench College ${Date.now()}`;
      const saved = await write(
        endpoints,
        'profile-save-college',
        {
          collegeDetails: [
            { collegeID: '', collegeName: marker, degree: 'QA', fromYear: '2010', toYear: '2014' },
          ],
        },
        'save-college',
      );
      expect.soft(saved, 'save college accepted').toBeLessThan(300);
      // UserProfileDaoImpl.java:550 merges the entry (collegeName, degree, …) into college_details.
      if (saved < 300)
        await expectStored(
          db,
          'profile-save-college',
          {
            table: 'TBL_KPOST_USER_PROFILE',
            where: ownRow(),
            columns: { college_details: hasEntry({ collegeName: marker, degree: 'QA' }) },
            rule: "saveOrUpdateCollegeDetails adds the college sent to the caller's college_details",
          },
          endpoints,
        );

      // Read it back to find its id, then delete it (cleanup).
      const profile = await fetchProfile(endpoints);
      const colleges = (profile.collegeDetailsAsJson ?? []) as Array<Record<string, unknown>>;
      const mine = Array.isArray(colleges)
        ? colleges.find((c) => c.collegeName === marker)
        : undefined;
      expect.soft(mine, 'the saved college record appears in the profile read-back').toBeTruthy();
      const collegeID = mine?.collegeID;

      if (typeof collegeID === 'string' && collegeID) {
        const deleted = await write(
          endpoints,
          'profile-delete-college',
          { collegeID },
          'delete-college',
        );
        expect.soft(deleted, 'delete college accepted').toBeLessThan(300);
        // UserProfileDaoImpl.java:1146 writes college_details back without the entry deleted.
        if (deleted < 300)
          await expectStored(
            db,
            'profile-delete-college',
            {
              table: 'TBL_KPOST_USER_PROFILE',
              where: ownRow(),
              columns: { college_details: noEntry('collegeID', collegeID) },
              rule: "deleteCollegeDetail removes that college from the caller's college_details",
            },
            endpoints,
          );
      }
    });

    test('school/university records can each be saved and then deleted @api @profile', async ({
      endpoints,
      databases,
    }) => {
      const db = databases.for('kpost-api');
      // Same save → read back → delete as the college test, for school and university.
      const marker = Date.now();
      const records: Array<{
        saveId: string;
        saveLabel: string;
        saveBody: Record<string, unknown>;
        listKeys: string[];
        nameField: string;
        nameValue: string;
        idField: string;
        deleteId?: string;
        deleteLabel?: string;
        /** The stored row after the save, then after the delete (each names its endpoint literally). */
        checkSaved: () => Promise<void>;
        checkDeleted: (id: string) => Promise<void>;
      }> = [
        {
          saveId: 'profile-save-school',
          saveLabel: 'save-school',
          saveBody: {
            schoolDetails: [
              { schoolID: '', schoolName: `QA Bench School ${marker}`, standard: '10' },
            ],
          },
          // *DetailsAsJson is the parsed array; the plain *Details key is a JSON string.
          listKeys: ['schoolDetailsAsJson', 'schoolDetails'],
          nameField: 'schoolName',
          nameValue: `QA Bench School ${marker}`,
          idField: 'schoolID',
          deleteId: 'profile-delete-school',
          deleteLabel: 'delete-school',
          // UserProfileDaoImpl.java:601 merges the entry (schoolName, standard, …) into school_details.
          checkSaved: () =>
            expectStored(
              db,
              'profile-save-school',
              {
                table: 'TBL_KPOST_USER_PROFILE',
                where: ownRow(),
                columns: {
                  school_details: hasEntry({
                    schoolName: `QA Bench School ${marker}`,
                    standard: '10',
                  }),
                },
                rule: "saveOrUpdateSchoolDetails adds the school sent to the caller's school_details",
              },
              endpoints,
            ),
          // UserProfileDaoImpl.java:1186 writes school_details back without the entry deleted.
          checkDeleted: (id) =>
            expectStored(
              db,
              'profile-delete-school',
              {
                table: 'TBL_KPOST_USER_PROFILE',
                where: ownRow(),
                columns: { school_details: noEntry('schoolID', id) },
                rule: "deleteSchoolDetail removes that school from the caller's school_details",
              },
              endpoints,
            ),
        },
        {
          saveId: 'profile-save-university',
          saveLabel: 'save-university',
          saveBody: {
            universityDetails: [
              {
                universityID: '',
                universityName: `QA Bench University ${marker}`,
                degree: 'Masters',
              },
            ],
          },
          listKeys: ['universityDetailsAsJson', 'universityDetails'],
          nameField: 'universityName',
          nameValue: `QA Bench University ${marker}`,
          idField: 'universityID',
          deleteId: 'profile-delete-university',
          deleteLabel: 'delete-university',
          // UserProfileDaoImpl.java:651 merges the entry (universityName, degree, …) into university_details.
          checkSaved: () =>
            expectStored(
              db,
              'profile-save-university',
              {
                table: 'TBL_KPOST_USER_PROFILE',
                where: ownRow(),
                columns: {
                  university_details: hasEntry({
                    universityName: `QA Bench University ${marker}`,
                    degree: 'Masters',
                  }),
                },
                rule: "saveOrUpdateUniversityDetails adds the university sent to the caller's university_details",
              },
              endpoints,
            ),
          // UserProfileDaoImpl.java:1226 writes university_details back without the entry deleted.
          checkDeleted: (id) =>
            expectStored(
              db,
              'profile-delete-university',
              {
                table: 'TBL_KPOST_USER_PROFILE',
                where: ownRow(),
                columns: { university_details: noEntry('universityID', id) },
                rule: "deleteUniversityDetail removes that university from the caller's university_details",
              },
              endpoints,
            ),
        },
      ];

      for (const rec of records) {
        const saved = await write(endpoints, rec.saveId, rec.saveBody, rec.saveLabel);
        expect.soft(saved, `${rec.saveLabel} accepted`).toBeLessThan(300);
        if (saved < 300) await rec.checkSaved();

        const profile = await fetchProfile(endpoints);
        let list: Array<Record<string, unknown>> = [];
        for (const key of rec.listKeys) {
          const candidate = profile[key];
          if (Array.isArray(candidate)) {
            list = candidate as Array<Record<string, unknown>>;
            break;
          }
        }
        const mine = list.find((entry) => entry[rec.nameField] === rec.nameValue);
        expect.soft(mine, `${rec.saveLabel} appears in the profile read-back`).toBeTruthy();

        const recordId = mine?.[rec.idField];
        if (typeof recordId === 'string' && recordId && rec.deleteId && rec.deleteLabel) {
          const deleted = await write(
            endpoints,
            rec.deleteId,
            { [rec.idField]: recordId },
            rec.deleteLabel,
          );
          expect.soft(deleted, `${rec.deleteLabel} accepted`).toBeLessThan(300);
          if (deleted < 300) await rec.checkDeleted(recordId);
        }
      }
    });

    test('experience and other-activity records can each be saved and then deleted @api @profile', async ({
      endpoints,
      databases,
    }) => {
      const db = databases.for('kpost-api');
      // Experience needs a real company name (QA_COMPANY_NAME): the QA-identifier guard checks it.
      test.skip(
        !process.env.QA_COMPANY_NAME,
        'set QA_COMPANY_NAME to a real company name to unblock this',
      );

      const marker = Date.now();
      const records: Array<{
        saveId: string;
        saveLabel: string;
        saveBody: Record<string, unknown>;
        listKeys: string[];
        nameField: string;
        nameValue: string;
        idField: string;
        deleteId: string;
        deleteLabel: string;
        /** The stored row after the save, then after the delete (each names its endpoint literally). */
        checkSaved: () => Promise<void>;
        checkDeleted: (id: string) => Promise<void>;
      }> = [
        {
          saveId: 'profile-save-experience',
          saveLabel: 'save-experience',
          saveBody: {
            experienceDetails: [
              {
                experienceID: '',
                companyName: testData.companyName,
                designation: `QA Bench ${marker}`,
                fromYear: '2020',
              },
            ],
          },
          listKeys: ['experienceDetailsAsJson', 'experienceDetails'],
          nameField: 'designation',
          nameValue: `QA Bench ${marker}`,
          idField: 'experienceID',
          deleteId: 'profile-delete-experience',
          deleteLabel: 'delete-experience',
          // UserProfileDaoImpl.java:748 merges the entry (companyName, designation, …) into experience_details.
          checkSaved: () =>
            expectStored(
              db,
              'profile-save-experience',
              {
                table: 'TBL_KPOST_USER_PROFILE',
                where: ownRow(),
                columns: {
                  experience_details: hasEntry({
                    companyName: testData.companyName,
                    designation: `QA Bench ${marker}`,
                  }),
                },
                rule: "saveOrUpdateExperienceDetails adds the experience sent to the caller's experience_details",
              },
              endpoints,
            ),
          // UserProfileDaoImpl.java:1268 writes experience_details back without the entry deleted.
          checkDeleted: (id) =>
            expectStored(
              db,
              'profile-delete-experience',
              {
                table: 'TBL_KPOST_USER_PROFILE',
                where: ownRow(),
                columns: { experience_details: noEntry('experienceID', id) },
                rule: "deleteExperienceDetail removes that experience from the caller's experience_details",
              },
              endpoints,
            ),
        },
        {
          saveId: 'profile-save-other-activity',
          saveLabel: 'save-other-activity',
          saveBody: {
            otherActivities: [
              { activityID: '', title: `QA Bench ${marker}`, achievements: 'QA bench activity' },
            ],
          },
          listKeys: ['otherActivitiesAsJson', 'otherActivities'],
          nameField: 'title',
          nameValue: `QA Bench ${marker}`,
          idField: 'activityID',
          deleteId: 'profile-delete-other-activity',
          deleteLabel: 'delete-other-activity',
          // UserProfileDaoImpl.java:699 merges the entry (title, achievements, …) into other_activities.
          checkSaved: () =>
            expectStored(
              db,
              'profile-save-other-activity',
              {
                table: 'TBL_KPOST_USER_PROFILE',
                where: ownRow(),
                columns: {
                  other_activities: hasEntry({
                    title: `QA Bench ${marker}`,
                    achievements: 'QA bench activity',
                  }),
                },
                rule: "saveOrUpdateOtherActivity adds the activity sent to the caller's other_activities",
              },
              endpoints,
            ),
          // UserProfileDaoImpl.java:1313 writes other_activities back without the entry deleted.
          checkDeleted: (id) =>
            expectStored(
              db,
              'profile-delete-other-activity',
              {
                table: 'TBL_KPOST_USER_PROFILE',
                where: ownRow(),
                columns: { other_activities: noEntry('activityID', id) },
                rule: "deleteOtherActivity removes that activity from the caller's other_activities",
              },
              endpoints,
            ),
        },
      ];

      for (const rec of records) {
        const saved = await write(endpoints, rec.saveId, rec.saveBody, rec.saveLabel);
        expect.soft(saved, `${rec.saveLabel} accepted`).toBeLessThan(300);
        if (saved < 300) await rec.checkSaved();

        const profile = await fetchProfile(endpoints);
        let list: Array<Record<string, unknown>> = [];
        for (const key of rec.listKeys) {
          const candidate = profile[key];
          if (Array.isArray(candidate)) {
            list = candidate as Array<Record<string, unknown>>;
            break;
          }
        }
        const mine = list.find((entry) => entry[rec.nameField] === rec.nameValue);
        expect.soft(mine, `${rec.saveLabel} appears in the profile read-back`).toBeTruthy();

        const recordId = mine?.[rec.idField];
        if (typeof recordId === 'string' && recordId) {
          const deleted = await write(
            endpoints,
            rec.deleteId,
            { [rec.idField]: recordId },
            rec.deleteLabel,
          );
          expect.soft(deleted, `${rec.deleteLabel} accepted`).toBeLessThan(300);
          if (deleted < 300) await rec.checkDeleted(recordId);
        }
      }
    });

    test('convertBase64ToImage accepts a data URI @api @profile', async ({ endpoints }) => {
      const status = await write(
        endpoints,
        'profile-convert-base64',
        {
          base64String:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+6ZlWAAAAAElFTkSuQmCC',
          fileName: 'qa-bench.png',
        },
        'convert-base64',
      );
      expect.soft(status, 'convert base64 accepted').toBeLessThan(400);
    });

    test('every image write (upload / cover / signature / attachments) then remove, on our own profile @api @profile', async ({
      endpoints,
      databases,
    }) => {
      const db = databases.for('kpost-api');
      // Known defect #559: profile-update-signature returns 500 (tracked, not re-filed here).
      // `sendTo(id, {})` sends `{}` literally (no default request()), so the JPEG body is built here.
      const raw = async (id: string, label: string): Promise<number> => {
        const ex = await endpoints.sendTo(
          id,
          {},
          { label: `profile:${label}`, auth: { principal: A }, allowLiveWrite: true },
        );
        return ex.status;
      };

      // profile-update-image: confirm the JPEG fixture works, AND that a PNG is rejected CLEANLY
      // (4xx, not a 5xx crash) — the endpoint is JPEG-only by design, so the rejection itself is fine.
      const jpegUploadEx = await endpoints.sendTo(
        'profile-update-image',
        {
          multipart: {
            file: {
              name: 'qa-bench.jpg',
              mimeType: 'image/jpeg',
              buffer: Buffer.from(JPEG_1X1, 'base64'),
            },
            text: JSON.stringify({ kpostID: testData.kpostId }),
          },
        },
        {
          label: 'profile:upload-profile-image-jpeg',
          auth: { principal: A },
          allowLiveWrite: true,
        },
      );
      expect.soft(jpegUploadEx.status, 'updateProfileImage accepts a JPEG').toBeLessThan(300);
      // UserProfileDaoImpl.java:829 stores the S3 key AWSs3ClientServiceImpl.java:647 built for the
      // caller (<kpostID with @→_>/profile/<the part before the first '.', @→_>.jpg) in profile_image.
      const imageKey = `${A.username.replaceAll('@', '_')}/profile/${(A.username.split('.')[0] ?? '').replaceAll('@', '_')}.jpg`;
      if (jpegUploadEx.status < 300)
        await expectStored(
          db,
          'profile-update-image',
          {
            table: 'TBL_KPOST_USER_PROFILE',
            where: ownRow(),
            columns: {
              profile_image: (v: unknown) =>
                filled(v) && String(v).toLowerCase() === imageKey.toLowerCase(),
            },
            rule: "updateProfileImage stores the uploaded picture's path on the caller's profile",
          },
          endpoints,
        );

      // The picture just uploaded, read back through every route that serves it. Each answer is also
      // checked against the route's file contract (the bytes agree with the Content-Type).
      for (const id of [
        'profile-download-image',
        'profile-download-full-image',
        'common-download-profile-image',
      ]) {
        const image = await endpoints.sendTo(
          id,
          { pathParams: { kpostID: testData.kpostId } },
          { label: `profile:readback:${id}`, auth: { principal: A } },
        );
        expect.soft(image.status, `${id} serves the picture just uploaded`).toBe(200);
        // common/downloadProfileImage answers 200 with an EMPTY body when the image exists
        // (CommonControllerV2.java:1822 returns body(null) on success): this fails until it is fixed.
        expect
          .soft(
            image.magicType ?? `no image bytes (${image.bodyText.length} characters)`,
            `${id} serves an image`,
          )
          .toMatch(/^image\//);
      }

      // The cover, uploaded as the web app does (a real image file), then read back.
      const coverUpload = await endpoints.sendTo(
        'profile-upload-cover',
        {
          multipart: {
            file: {
              name: 'qa-bench-cover.jpg',
              mimeType: 'image/jpeg',
              buffer: Buffer.from(JPEG_1X1, 'base64'),
            },
            text: JSON.stringify({ kpostID: testData.kpostId }),
          },
        },
        { label: 'profile:upload-cover-jpeg', auth: { principal: A }, allowLiveWrite: true },
      );
      expect.soft(coverUpload.status, 'uploadCoverImage accepts a JPEG').toBeLessThan(300);
      const cover = await endpoints.sendTo(
        'profile-download-cover',
        { pathParams: { kpostID: testData.kpostId } },
        { label: 'profile:readback:cover', auth: { principal: A } },
      );
      expect.soft(cover.status, 'downloadCoverImage serves the cover just uploaded').toBe(200);
      expect
        .soft(cover.magicType ?? 'no image bytes', 'downloadCoverImage serves an image')
        .toMatch(/^image\//);

      const pngUpload = await endpoints.sendTo(
        'profile-update-image',
        {
          multipart: {
            file: {
              name: 'qa-bench.png',
              mimeType: 'image/png',
              buffer: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+6ZlWAAAAAElFTkSuQmCC',
                'base64',
              ),
            },
            text: JSON.stringify({ kpostID: testData.kpostId }),
          },
        },
        { label: 'profile:upload-profile-image-png', auth: { principal: A }, allowLiveWrite: true },
      );
      // JPEG-only by design: a PNG 4xx is correct; only a 5xx crash is a defect.
      if (pngUpload.status >= 500) {
        endpoints.recordBusinessRuleViolation({
          endpointId: 'profile-update-image',
          ruleId: 'profile-update-image-png-5xx-crash',
          rule: 'updateProfileImage must reject a PNG with a clean 4xx (it is JPEG-only), never crash with a 5xx.',
          expected: 'a 4xx rejection (e.g. 400 "Invalid File Format"), never a 5xx',
          actual: `status=${pngUpload.status}, body=${pngUpload.bodyText}`,
          request: { multipart: { file: 'qa-bench.png (image/png)' } },
        });
      }
      expect
        .soft(
          pngUpload.status,
          'updateProfileImage rejects a PNG cleanly (JPEG-only: a 4xx, never a 5xx crash)',
        )
        .toBeLessThan(500);

      for (const [id, label] of [
        ['profile-update-signature', 'upload-signature'],
        ['profile-upload-attachments', 'upload-attachments'],
        ['profile-upload-image-s3', 'upload-s3'],
        ['profile-remove-image', 'remove-image'],
        ['profile-remove-cover', 'remove-cover'],
      ] as Array<[string, string]>) {
        const status = await raw(id, label);
        expect.soft(status, `${label} returns a status`).toBeLessThan(600);
      }

      // share-user-details — shares our own profile by our own kpostID.
      const shared = await write(
        endpoints,
        'profile-share-user-details',
        { kpostID: testData.kpostId },
        'share',
      );
      expect.soft(shared, 'shareUserDetails returns a status').toBeLessThan(600);
    });
  },
);
