import type { EndpointFilter } from '@api/registry/api-registry';
import { forWriteSweep } from '@api/sweep-target';
import { kmailAuthGate } from '@fixtures/kmail-auth-gate';
import { test } from '@fixtures';
import type { CheckType } from './check-types';
import { describeEndpointCases, type EndpointCaseOptions } from './endpoint-cases';

/**
 * WHICH endpoints the engine sweeps, declared once per product and module. Each type folder's spec
 * (`tests/<product>/<type>/[<module>/]<module>-endpoints-<type>.spec.ts`) is one call to
 * `describeEndpointChecks`, so every type reports the same endpoints with the same options, and the
 * engine runs each endpoint once for all of them (`shared-run.ts`).
 *
 * A group's `title` and `tags` are the outer describe of its tests, unchanged from the per-module
 * engine specs they replace (2026-11-05): test titles, `--grep "[endpoint-id]"` and the happy-path
 * report read them.
 */
export interface EndpointGroup {
  readonly title: string;
  readonly tags: readonly string[];
  readonly filter: EndpointFilter;
  readonly options?: Omit<EndpointCaseOptions, 'checks'>;
  /** A reason to skip the whole group (e.g. the KMail auth gate), or undefined to run it. */
  readonly skip?: () => string | undefined;
}

export type ApiProduct = 'kpost-api' | 'kmail-api' | 'admin-api';

const kpost = (
  title: string,
  tag: string,
  filter: EndpointFilter,
  options?: EndpointGroup['options'],
): EndpointGroup => ({
  title,
  tags: ['@api', tag, '@regression'],
  filter,
  ...(options && { options }),
});

/** Writes aim "the other party" at the sacrificial account, never the counterparty the flows use. */
const writes = { transform: forWriteSweep };

export const ENDPOINT_GROUPS: Readonly<
  Record<ApiProduct, Readonly<Record<string, readonly EndpointGroup[]>>>
> = {
  'kpost-api': {
    // The presigned-URL generators run on live; check/delete need a uuid (`needs-attachment`).
    aws: [kpost('KPost AWS · endpoints', '@platform', { tags: ['aws'] })],
    common: [
      // Known defect: downloadCompanyLogo answers 500 to every request.
      kpost('KPost common · company', '@platform', { tags: ['common-company'] }),
      // Each answers a question about somebody else's data without a token: the security checks carry the weight.
      kpost('KPost common · identity lookups', '@platform', { tags: ['common-identity'] }),
      kpost('KPost common · reference data', '@platform', { tags: ['common-reference'] }),
      // validateOTP / validateMailOTP need a prior send in the same run; the OTP lifecycle covers them.
      kpost('KPost common · OTP and password recovery', '@platform', {
        tags: ['common-otp'],
        excludeTags: ['otp-consume'],
      }),
      kpost('KPost common · platform', '@platform', { tags: ['common-platform'] }),
    ],
    contacts: [
      kpost('KPost Contacts · reads', '@contacts', { tags: ['contacts-read'] }),
      kpost('KPost Contacts · writes', '@contacts', { tags: ['contacts-write'] }, writes),
    ],
    dashboard: [kpost('KPost Dashboard · reads', '@home', { tags: ['dashboard-read'] })],
    group: [
      kpost(
        'KPost Group · manage',
        '@group',
        { tags: ['group-manage', 'group-read', 'group-image'] },
        writes,
      ),
    ],
    kall: [
      // The two kallID-keyed status reads skip on live (`needs-kall-id`).
      kpost('KPost Kall · reads', '@kall', { tags: ['kall-read'] }),
      kpost(
        'KPost Kall · writes',
        '@kall',
        { tags: ['kall-direct', 'kall-schedule', 'kall-legacy'] },
        writes,
      ),
    ],
    katchup: [
      // Attachment, manage and id-keyed reads need a real uuid / message id: they skip on live with the reason.
      kpost('KPost Katchup · attachments', '@katchup', { tags: ['katchup-attachment'] }),
      kpost('KPost Katchup · manage', '@katchup', { tags: ['katchup-manage'] }),
      kpost('KPost Katchup · reads', '@katchup', { tags: ['katchup-read'] }),
      // Sends reach a real inbox: none is productionSafe, so they run in full only against the mock.
      kpost('KPost Katchup · sends', '@katchup', { tags: ['katchup-send'] }),
    ],
    kbooking: [
      // block-ticket is left out: it holds a real seat at the booking partner.
      kpost('KPost KBooking · details', '@verticals', {
        ids: ['kbooking-trip-details', 'kbooking-trip-details-v2', 'kbooking-boarding-point'],
      }),
      kpost('KPost KBooking · reads', '@verticals', { tags: ['kbooking-read'] }),
    ],
    kdiary: [
      kpost('KPost KDiary · reads', '@verticals', { tags: ['kdiary-read'] }),
      kpost('KPost KDiary · writes', '@verticals', { tags: ['kdiary-write'] }, writes),
    ],
    // The feed administration (/admin/news/*) is defined but never driven: it changes every user's news.
    knews: [kpost('KPost KNews · news', '@verticals', { tags: ['knews'] })],
    profile: [
      kpost('KPost Profile · device', '@profile', { tags: ['profile-device'] }),
      kpost('KPost Profile · image', '@profile', { tags: ['profile-image'] }),
      kpost('KPost Profile · read', '@profile', { tags: ['profile-read'] }),
      kpost('KPost Profile · write', '@profile', { tags: ['profile-write'] }),
    ],
    settings: [
      kpost('KPost Settings · reads', '@settings', { tags: ['settings-read'] }),
      // They act on the caller's own account only, so no retargeting is needed.
      kpost('KPost Settings · writes', '@settings', { tags: ['settings-write'] }),
    ],
    'signup-login': [
      // userLogout would end the shared cached session; the login authentication spec tests it on its own.
      kpost('KPost Login · contract validation', '@auth', {
        tags: ['login'],
        excludeTags: ['session-ending'],
      }),
      // The two registration endpoints are @destructive and excluded by the config's grepInvert.
      kpost('KPost Signup · contract validation', '@auth', { tags: ['signup'] }),
    ],
  },
  'kmail-api': {
    kmail: [
      {
        title: 'KMail API',
        tags: ['@api', '@kmail', '@regression'],
        // `needs-login` endpoints stay registered (coverage, bug routing) but are not run here.
        filter: { suites: ['kmail-api'], excludeTags: ['needs-login', 'not-in-use'] },
        options: { allowEmpty: true },
        // Gated while KMail refuses every valid KPost token (src/fixtures/kmail-auth-gate.ts).
        skip: kmailAuthGate,
      },
    ],
  },
  'admin-api': {
    admin: [
      {
        title: 'Admin API',
        tags: [],
        // Role-posting writes create real KPost/KSMACC accounts, which fuzzing must not touch
        // (admin-role-posting-e2e.spec.ts covers them). Skips until ADMIN_API_BASE_URL is set.
        filter: { suites: ['admin-api'], excludeTags: ['role-posting-mutation'] },
        options: { allowEmpty: true },
      },
    ],
  },
};

/**
 * The engine checks of one type for one module's endpoints. The whole body of a type folder's
 * engine spec, e.g. `describeEndpointChecks('kpost-api', 'kall', 'negative')`.
 */
export function describeEndpointChecks(
  product: ApiProduct,
  module: string,
  checks: CheckType,
): void {
  const groups = ENDPOINT_GROUPS[product][module];
  if (!groups) throw new Error(`no endpoint groups for ${product} module "${module}"`);
  for (const group of groups) {
    test.describe(group.title, { tag: [...group.tags] }, () => {
      const reason = group.skip?.();
      test.skip(reason !== undefined, reason ?? '');
      describeEndpointCases(group.filter, { ...group.options, checks });
    });
  }
}
