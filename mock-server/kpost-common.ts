import { z } from 'zod';
import type { Ctx, HttpErrorLike, MockHelpers, Route } from './server.ts';

/**
 * The KPost **common** module, modelled from the workbook's own documented samples.
 *
 * ## Why the mock exists in this shape
 *
 * The real host is not always reachable, and two of these endpoints send SMS and email. Modelling
 * them locally makes the whole suite runnable and reviewable today, and — more importantly — makes
 * the tests falsifiable: a validator that passes against this mock is a validator that actually
 * checks something, because the mock answers with the real API's envelope rather than whatever
 * would make the tests green.
 *
 * ## It is deliberately NOT bug-compatible with the bench
 *
 * The mock validates requests on its own terms (required fields, types, ranges) so the centralized
 * negative probes have something real to push against. Where the real API's behaviour is unknown —
 * above all its **error body**, which the workbook never documents — the mock picks a shape and the
 * bench does **not** assert it (`RESPONSE_CONTRACTS.kpost.error` is undefined). Asserting the
 * mock's invention would be testing this file, not KPost.
 *
 * Envelope, from 119 documented samples: `{ status: "SUCCESS", statusCode, urlPath, message?, data? }`.
 */

/** Seed that matches the defaults in src/config/test-data.config.ts. */
const REGISTERED_MOBILES = new Set(['9000000949', '9000000950', '9000000951', '9000000952']);
const COMPANIES = new Map<number, { name: string; uniqueName: string; domain: string }>([
  [1, { name: 'QA Bench Company', uniqueName: 'qabench', domain: 'kpost.in' }],
]);
const COUNTRIES = [
  { countryID: 1, countryName: 'India', dialCode: '+91', isoCode: 'IN' },
  { countryID: 2, countryName: 'Singapore', dialCode: '+65', isoCode: 'SG' },
];
const STATES = [
  { stateId: 1, stateName: 'Tamil Nadu', countryID: 1 },
  { stateId: 2, stateName: 'Karnataka', countryID: 1 },
];
const CITIES = new Map<number, { cityId: number; cityName: string }[]>([
  [
    1,
    [
      { cityId: 11, cityName: 'Chennai' },
      { cityId: 12, cityName: 'Coimbatore' },
    ],
  ],
]);
const PINCODES = new Map<string, { postalCode: string; city: string; state: string }>([
  ['600001', { postalCode: '600001', city: 'Chennai', state: 'Tamil Nadu' }],
]);
const LANGUAGES = [
  { languageId: 1, languageName: 'English' },
  { languageId: 2, languageName: 'Tamil' },
];
const DESIGNATIONS = ['Software Engineer', 'Software Architect', 'Software Tester'];
const DOMAINS = ['kpost.in', 'kpostindia.com'];
const MODULE_SUBSCRIBERS = new Map<number, string[]>([[1, ['qa.bench@kpost.in']]]);

let appVersion = '1.0.35:117';

/**
 * OTPs are generated, never returned. The real API does not expose the code it sent, and a mock
 * that did would let a test "verify" an OTP it was handed - a test that can never fail.
 */
const sentOtps = new Map<string, string>();

/** Anything the bench sends that is not a real destination still gets a real-looking answer. */
const otpKey = (channel: string, destination: string): string => `${channel}:${destination}`;

export function kpostCommonRoutes({ send, readJson, HttpError }: MockHelpers): Route[] {
  /** The KPost success envelope. `urlPath` is the endpoint's own name, as the samples show. */
  const ok = (ctx: Ctx, urlPath: string, extra: Record<string, unknown> = {}): void => {
    send(ctx, 200, { status: 'SUCCESS', statusCode: 200, urlPath, ...extra });
  };

  /**
   * Rejects an invalid request. The status is asserted by the bench; the body shape is not, because
   * KPost's error contract is undocumented (see contracts/excel-gaps.md).
   */
  const badRequest = (message: string, field?: string): HttpErrorLike =>
    new HttpError(400, 'VALIDATION_ERROR', message, {
      errors: field ? [{ field, message }] : undefined,
    });

  async function parseBody<T>(ctx: Ctx, schema: z.ZodType<T>): Promise<T> {
    const result = schema.safeParse(await readJson(ctx.req));
    if (result.success) return result.data;
    const issue = result.error.issues[0];
    throw badRequest(issue?.message ?? 'Request validation failed', issue?.path.join('.'));
  }

  // A mobile number: 10 digits, no country code. Strings only - the workbook documents both a
  // string and a number for different endpoints, and each is modelled as documented.
  const mobileString = z.string().regex(/^\d{10}$/, 'mobileNumber must be 10 digits');
  const mobileNumeric = z.coerce.number().int().min(1_000_000_000).max(9_999_999_999);
  const countryId = z.number().int().positive();
  const kpostId = z.string().min(3).includes('@');

  return [
    // ------------------------------------------------------------------ reference data
    {
      method: 'GET',
      pattern: /^\/v2\/common\/countries$/,
      handler: (ctx) => ok(ctx, 'countries', { data: COUNTRIES }),
    },
    {
      method: 'GET',
      pattern: /^\/v2\/common\/getStates\/?$/,
      handler: (ctx) => ok(ctx, 'getStates', { data: STATES }),
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/getCitiesByRegionId\/?$/,
      handler: async (ctx) => {
        const body = await parseBody(ctx, z.object({ regionId: z.number().int().positive() }));
        ok(ctx, 'getCitiesByRegionId', { data: CITIES.get(body.regionId) ?? [] });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/pinCode$/,
      handler: async (ctx) => {
        const body = await parseBody(ctx, z.object({ postalCode: z.coerce.number().int() }));
        const found = PINCODES.get(String(body.postalCode));
        ok(ctx, 'pinCode', { data: found ?? null, message: found ? 'Found' : 'No match' });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/postalPinCode\/?$/,
      handler: async (ctx) => {
        const body = await parseBody(ctx, z.object({ postalCode: z.coerce.number().int() }));
        const found = PINCODES.get(String(body.postalCode));
        ok(ctx, 'postalPinCode', { data: found ?? null });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/languages$/,
      handler: async (ctx) => {
        await parseBody(ctx, z.object({ countryID: countryId }));
        ok(ctx, 'languages', { data: LANGUAGES });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/getDesignation\/?$/,
      handler: async (ctx) => {
        const body = await parseBody(ctx, z.object({ designation: z.string().min(1) }));
        const needle = body.designation.toLowerCase();
        ok(ctx, 'getDesignation', {
          data: DESIGNATIONS.filter((d) => d.toLowerCase().includes(needle)),
        });
      },
    },

    // ------------------------------------------------------------------ identity lookups
    {
      method: 'POST',
      pattern: /^\/v2\/common\/mobileNoExist\/?$/,
      handler: async (ctx) => {
        const body = await parseBody(
          ctx,
          z.object({ countryID: countryId, mobileNumber: mobileString }),
        );
        const used = REGISTERED_MOBILES.has(body.mobileNumber);
        ok(ctx, 'mobileNoExist', {
          used,
          // No name, email or KPost ID: an existence check answers only "is it taken".
          message: used ? 'Mobile number already registered' : 'Mobile number can be used',
        });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/mobileNoExistInsideCompany\/?$/,
      handler: async (ctx) => {
        const body = await parseBody(
          ctx,
          z.object({ mobileNumber: mobileString, companyID: z.number().int().positive() }),
        );
        if (!COMPANIES.has(body.companyID))
          throw new HttpError(404, 'NOT_FOUND', 'Company not found');
        ok(ctx, 'mobileNoExistInsideCompany', { used: REGISTERED_MOBILES.has(body.mobileNumber) });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/getUserDetailsByMobNo$/,
      handler: async (ctx) => {
        const body = await parseBody(ctx, z.object({ mobileNumber: mobileNumeric }));
        const known = REGISTERED_MOBILES.has(String(body.mobileNumber));
        // Deliberately minimal: a public endpoint returning a full profile would be a finding.
        ok(ctx, 'getUserDetailsByMobNo', {
          data: known ? { mobileNumber: String(body.mobileNumber), registered: true } : null,
        });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/getKpostIdUsingModule$/,
      handler: async (ctx) => {
        const body = await parseBody(
          ctx,
          z.object({ module: z.array(z.number().int().nonnegative()).min(1) }),
        );
        ok(ctx, 'getKpostIdUsingModule', {
          data: body.module.flatMap((id) => MODULE_SUBSCRIBERS.get(id) ?? []),
        });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/uniqueNameExist$/,
      handler: async (ctx) => {
        const body = await parseBody(
          ctx,
          z.object({
            companyName: z.string().min(1),
            uniqueName: z.string().min(1),
            domain: z.string().min(1),
          }),
        );
        const taken = [...COMPANIES.values()].some((c) => c.uniqueName === body.uniqueName);
        ok(ctx, 'uniqueNameExist', { used: taken });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/domain\/?$/,
      handler: async (ctx) => {
        await parseBody(ctx, z.object({ countryID: countryId, userType: z.string().min(1) }));
        ok(ctx, 'domain', { data: DOMAINS });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/generateDomainAndUniqueName$/,
      handler: async (ctx) => {
        const body = await parseBody(
          ctx,
          z.object({ kpostID: kpostId, companyName: z.string().min(1) }),
        );
        const slug = body.companyName
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .slice(0, 12);
        ok(ctx, 'generateDomainAndUniqueName', {
          data: { uniqueName: slug, domain: `${slug}.kpost.in` },
        });
      },
    },

    // ------------------------------------------------------------------ company
    {
      method: 'POST',
      pattern: /^\/v2\/common\/getCompanyDetails$/,
      handler: async (ctx) => {
        const body = await parseBody(ctx, z.object({ mobileNumber: mobileNumeric }));
        const known = REGISTERED_MOBILES.has(String(body.mobileNumber));
        ok(ctx, 'getCompanyDetails', {
          data: known ? { companyID: 1, ...COMPANIES.get(1) } : null,
        });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/getCompanyDetailsByAdmin$/,
      handler: async (ctx) => {
        const body = await parseBody(ctx, z.object({ mobileNumber: mobileString }));
        ok(ctx, 'getCompanyDetailsByAdmin', {
          data: REGISTERED_MOBILES.has(body.mobileNumber)
            ? { companyID: 1, ...COMPANIES.get(1) }
            : null,
        });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/getCompanyDetailsByMobileNoAndproductId$/,
      handler: async (ctx) => {
        const body = await parseBody(
          ctx,
          z.object({ mobileNumber: mobileString, productId: z.string().min(8) }),
        );
        ok(ctx, 'getCompanyDetailsByMobileNoAndproductId', {
          data: REGISTERED_MOBILES.has(body.mobileNumber)
            ? { companyID: 1, productId: body.productId }
            : null,
        });
      },
    },
    {
      method: 'GET',
      pattern: /^\/v2\/common\/getCompanyNameExistOnKpostAndKsmacc\/(?<companyName>[^/]+)$/,
      handler: (ctx, params) => {
        const name = decodeURIComponent(params.companyName ?? '');
        if (!name.trim()) throw badRequest('companyName is required', 'companyName');
        ok(ctx, 'getCompanyNameExistOnKpostAndKsmacc', {
          // Echoing the raw name back would make this a reflected-XSS carrier; the bench probes it.
          used: [...COMPANIES.values()].some((c) => c.name.toLowerCase() === name.toLowerCase()),
        });
      },
    },
    {
      method: 'POST',
      pattern: /^\/common\/updateCompanyLogo$/,
      handler: async (ctx) => {
        const body = await parseBody(ctx, z.object({ companyID: z.number().int().positive() }));
        if (!COMPANIES.has(body.companyID))
          throw new HttpError(404, 'NOT_FOUND', 'Company not found');
        ok(ctx, 'updateCompanyLogo', { message: 'Logo updated successfully' });
      },
    },
    {
      method: 'GET',
      pattern: /^\/common\/downloadCompanyLogo\/(?<companyID>[^/]+)$/,
      handler: (ctx, params) => {
        const id = Number(params.companyID);
        if (!Number.isInteger(id) || id <= 0) throw badRequest('companyID must be an integer');
        if (!COMPANIES.has(id)) throw new HttpError(404, 'NOT_FOUND', 'Company not found');
        // A 1x1 PNG: the smallest honest binary response.
        const png = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+6ZlWAAAAAElFTkSuQmCC',
          'base64',
        );
        ctx.res.writeHead(200, {
          'content-type': 'image/png',
          'content-length': String(png.length),
          'x-correlation-id': ctx.correlationId,
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
        });
        ctx.res.end(png);
      },
    },

    // ------------------------------------------------------------------ OTP + password reset
    {
      method: 'POST',
      pattern: /^\/v2\/common\/sendOTP\/?$/,
      handler: async (ctx) => {
        const body = await parseBody(
          ctx,
          z.object({
            countryID: countryId,
            mobileNumber: mobileString,
            requestType: z.enum(['signup', 'business', 'institution']),
          }),
        );
        sentOtps.set(
          otpKey('sms', body.mobileNumber),
          String(100_000 + Math.floor(Math.random() * 899_999)),
        );
        ok(ctx, 'sendOTP', {
          message: 'OTP has been sent to given mobile number. Valid for 10 minutes only.',
        });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/validateOTP\/?$/,
      handler: async (ctx) => {
        const body = await parseBody(
          ctx,
          z.object({
            otp: z.union([z.string().min(4), z.number().int()]),
            countryID: countryId,
            mobileNumber: mobileString,
            sendDate: z.number().int().positive(),
          }),
        );
        const expected = sentOtps.get(otpKey('sms', body.mobileNumber));
        if (!expected || String(body.otp) !== expected) {
          // Same answer whether the number is unknown or the code is wrong: no enumeration.
          throw new HttpError(400, 'INVALID_OTP', 'OTP is invalid or has expired');
        }
        sentOtps.delete(otpKey('sms', body.mobileNumber));
        ok(ctx, 'validateOTP', { message: 'OTP verified' });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/sendOTPtoMail\/?$/,
      handler: async (ctx) => {
        const body = await parseBody(ctx, z.object({ otherEmail: z.string().email() }));
        sentOtps.set(
          otpKey('mail', body.otherEmail),
          String(100_000 + Math.floor(Math.random() * 899_999)),
        );
        ok(ctx, 'sendOTPtoMail', { message: 'OTP has been sent to the given email address.' });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/validateMailOTP\/?$/,
      handler: async (ctx) => {
        const body = await parseBody(
          ctx,
          z.object({
            email: z.string().email(),
            sendDate: z.number().int().positive(),
            otp: z.union([z.string().min(4), z.number().int()]),
          }),
        );
        const expected = sentOtps.get(otpKey('mail', body.email));
        if (!expected || String(body.otp) !== expected) {
          throw new HttpError(400, 'INVALID_OTP', 'OTP is invalid or has expired');
        }
        sentOtps.delete(otpKey('mail', body.email));
        ok(ctx, 'validateMailOTP', { message: 'OTP verified' });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/forgotPasswordOTPOrSentKpostIDSms$/,
      handler: async (ctx) => {
        const body = await parseBody(
          ctx,
          z.object({ kpostID: kpostId, requestType: z.enum(['password', 'kpostID']) }),
        );
        // Always the same answer: revealing "no such account" here enumerates users.
        ok(ctx, 'forgotPasswordOTPOrSentKpostIDSms', {
          message: 'If the account exists, an SMS has been sent.',
          mobileNumber: '******' + body.kpostID.length.toString().padStart(4, '0'),
          countryID: 1,
        });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/forgotPasswordUpdate$/,
      handler: async (ctx) => {
        const body = await parseBody(
          ctx,
          z.object({ kpostID: kpostId, forgotPassword: z.string().min(8) }),
        );
        /*
         * The mock requires a verified OTP before it will change a password. If the real API does
         * not, that is an account-takeover defect - and this is the shape of the check that proves
         * it, because the bench sends this call without ever validating an OTP.
         */
        if (sentOtps.has(otpKey('reset', body.kpostID))) {
          sentOtps.delete(otpKey('reset', body.kpostID));
          ok(ctx, 'forgotPasswordUpdate', { message: 'Password updated' });
          return;
        }
        throw new HttpError(401, 'OTP_REQUIRED', 'Verify the OTP before changing the password');
      },
    },

    // ------------------------------------------------------------------ platform
    {
      method: 'GET',
      pattern: /^\/v2\/common\/msStatus\/?$/,
      handler: (ctx) => send(ctx, 200, { status: 'SUCCESS' }),
    },
    {
      method: 'GET',
      pattern: /^\/v2\/common\/getFlutterAppVersion\/?$/,
      handler: (ctx) => ok(ctx, 'getFlutterAppVersion', { data: { currentVersion: appVersion } }),
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/updateFlutterAppVersion$/,
      handler: async (ctx) => {
        const body = await parseBody(
          ctx,
          z.object({ currentVersion: z.string().regex(/^\d+\.\d+\.\d+:\d+$/) }),
        );
        appVersion = body.currentVersion;
        ok(ctx, 'updateFlutterAppVersion', { message: 'Version updated' });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/saveEnquiryDetails$/,
      handler: async (ctx) => {
        await parseBody(
          ctx,
          z.object({
            companyName: z.string().min(1),
            entity: z.string().min(1),
            maximumMembersCount: z.number().int().positive(),
            firstName: z.string().min(1),
            lastName: z.string().min(1),
            designation: z.string().min(1),
            mobileNumber: mobileString,
            email: z.string().email(),
          }),
        );
        ok(ctx, 'saveEnquiryDetails', { message: 'Enquiry saved' });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/saveUnsubscriberDetails$/,
      handler: async (ctx) => {
        await parseBody(
          ctx,
          z.object({
            sender: z.string().min(3),
            receiver: z.string().min(3),
            reason: z.string().min(1),
            createdBy: z.string().min(3),
          }),
        );
        ok(ctx, 'saveUnsubscriberDetails', { message: 'Unsubscribe recorded' });
      },
    },
    {
      method: 'POST',
      pattern: /^\/v2\/common\/getTotalCountByDate$/,
      handler: async (ctx) => {
        await parseBody(ctx, z.object({ date: z.number().int().positive() }));
        ok(ctx, 'getTotalCountByDate', { data: { katchup: 0, kall: 0, kmail: 0 } });
      },
    },
  ];
}
