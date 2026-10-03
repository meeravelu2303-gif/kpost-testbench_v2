import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { expect, test } from '@fixtures';

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

/** Matches the bench's own QA-generated markers, never a real user's data. */
const QA_MARKER = /^QA( Bench)?( College| School \d+| University \d+)?( \d{10,})?$/i;

test('scratch: clean up orphaned QA junk records on the primary account @framework', async ({
  endpoints,
}) => {
  const profileEx = await endpoints.sendTo(
    'profile-get-user-profile',
    {},
    { label: 'cleanup:fetch', auth: { principal: A } },
  );
  const parsed = profileEx.json();
  const value = (parsed.ok ? parsed.value : {}) as Record<string, unknown>;
  const data = (value.data as Record<string, unknown> | undefined) ?? {};
  const profile = (data.userProfile as Record<string, unknown> | undefined) ?? {};

  type Plan = { deleteId: string; idField: string; id: string; label: string };
  const plans: Plan[] = [];

  const otherActivities = (profile.otherActivitiesAsJson ?? []) as Array<Record<string, unknown>>;
  for (const a of otherActivities) {
    if (typeof a.title === 'string' && QA_MARKER.test(a.title) && typeof a.activityID === 'string') {
      plans.push({
        deleteId: 'profile-delete-other-activity',
        idField: 'activityID',
        id: a.activityID,
        label: `other-activity "${a.title}"`,
      });
    }
  }

  const experience = (profile.experienceDetailsAsJson ?? []) as Array<Record<string, unknown>>;
  for (const e of experience) {
    const designation = typeof e.designation === 'string' ? e.designation : '';
    const company = typeof e.companyName === 'string' ? e.companyName : '';
    if (
      (QA_MARKER.test(designation) || company === 'QA Bench Pvt Ltd') &&
      typeof e.experienceID === 'string'
    ) {
      plans.push({
        deleteId: 'profile-delete-experience',
        idField: 'experienceID',
        id: e.experienceID,
        label: `experience "${designation}" @ "${company}"`,
      });
    }
  }

  const colleges = (profile.collegeDetailsAsJson ?? []) as Array<Record<string, unknown>>;
  for (const c of colleges) {
    if (typeof c.collegeName === 'string' && QA_MARKER.test(c.collegeName) && typeof c.collegeID === 'string') {
      plans.push({
        deleteId: 'profile-delete-college',
        idField: 'collegeID',
        id: c.collegeID,
        label: `college "${c.collegeName}"`,
      });
    }
  }

  const schools = (profile.schoolDetailsAsJson ?? []) as Array<Record<string, unknown>>;
  for (const s of schools) {
    if (typeof s.schoolName === 'string' && QA_MARKER.test(s.schoolName) && typeof s.schoolID === 'string') {
      plans.push({
        deleteId: 'profile-delete-school',
        idField: 'schoolID',
        id: s.schoolID,
        label: `school "${s.schoolName}"`,
      });
    }
  }

  const universities = (profile.universityDetailsAsJson ?? []) as Array<Record<string, unknown>>;
  for (const u of universities) {
    if (
      typeof u.universityName === 'string' &&
      QA_MARKER.test(u.universityName) &&
      typeof u.universityID === 'string'
    ) {
      plans.push({
        deleteId: 'profile-delete-university',
        idField: 'universityID',
        id: u.universityID,
        label: `university "${u.universityName}"`,
      });
    }
  }

  console.log(`CLEANUP PLAN: ${plans.length} records to delete`);
  for (const p of plans) console.log(' -', p.label, p.id);

  let deleted = 0;
  let failed = 0;
  if (process.env.CLEANUP_EXECUTE === 'true') {
    for (const p of plans) {
      const ex = await endpoints.sendTo(
        p.deleteId,
        { body: { [p.idField]: p.id } },
        { label: `cleanup:delete:${p.label}`, auth: { principal: A }, allowLiveWrite: true },
      );
      if (ex.status < 300) deleted++;
      else {
        failed++;
        console.log(`CLEANUP FAILED: ${p.label} (${p.id}) -> ${ex.status} ${ex.bodyText.slice(0, 120)}`);
      }
    }
    console.log(`CLEANUP RESULT: ${deleted} deleted, ${failed} failed, ${plans.length} total planned`);
  } else {
    console.log('DRY RUN — set CLEANUP_EXECUTE=true to actually delete the planned records above');
  }

  expect(failed, 'all planned deletes succeeded').toBe(0);
});
