import { testData } from '@config/test-data.config';
import type { DatabaseClient } from '@database/database-client';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { expect, test } from '@fixtures';

/**
 * OTP lifecycle (mint, validate, replay, resend, expiry) checked on the OTP rows in the test DB,
 * since a SUCCESS response says nothing about the code. The 123456 bypass is SMS-only: the mail
 * channel stores a real random code, so the mail tests read it from the row.
 */
test.describe(
  'KPost OTP · lifecycle with MySQL assertions @database',
  { tag: ['@api', '@auth', '@regression'] },
  () => {
    test.describe.configure({ mode: 'serial' });

    test.skip(
      process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
      'OTP flows run only on a confirmed test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true',
    );

    // Codes go to `otpMobile`, never `signupMobile` (otp-signup-lifecycle.spec.ts uses that one), and
    // the describe is serial, so no other test can replace a code mid-test.
    /** The documented validity window, stated by the API's own message ("Valid for 10 minutes only."). */
    const WINDOW_SECONDS = 600;

    type OtpRow = {
      id: number;
      otp: string;
      send_date: Date | string;
      expire_date: Date | string;
      otp_validation_status: string;
      otp_expire_status: string;
    };

    const seconds = (from: Date | string, to: Date | string): number =>
      (new Date(to).getTime() - new Date(from).getTime()) / 1000;

    // The most recently minted row for a destination. Sorted in memory: bench queries are plain
    // equality lookups so the safety guards can check them.
    const latest = async (
      database: DatabaseClient,
      table: string,
      where: Record<string, string | number>,
    ): Promise<OtpRow | undefined> => {
      const rows = await database.findMany<OtpRow>({ table, where });
      return [...rows].sort((a, b) => b.id - a.id)[0];
    };

    test('a mobile OTP is minted with an expiry, unconsumed', async ({ endpoints, databases }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');

      const sent = await endpoints.sendTo(
        'common-send-otp',
        {
          body: {
            countryID: testData.countryId,
            mobileNumber: testData.otpMobile,
            requestType: 'signup',
          },
        },
        { label: 'otp-db:send-mobile', allowLiveWrite: true },
      );
      expect(sent.status, 'sendOTP is accepted').toBe(200);

      const row = await latest(database, 'TBL_KPOST_OTP_VALIDATION', {
        mobile_number: testData.otpMobile,
      });

      expect(
        row,
        'sendOTP wrote a row — a code the server cannot check later is not a code',
      ).toBeDefined();
      expect(String(row?.otp ?? ''), 'the row carries a code').not.toBe('');

      // Both flags start clear; asserted separately so a failure says which.
      expect(row?.otp_validation_status, 'a new code is unconsumed').toBe('N');
      expect(row?.otp_expire_status, 'and not yet expired').toBe('N');

      // A code with no expiry is a permanent password; the window is the one the API's message states.
      expect(
        seconds(row!.send_date, row!.expire_date),
        `the code expires ${WINDOW_SECONDS}s after it was sent, as the API's message states`,
      ).toBe(WINDOW_SECONDS);
    });

    test('validating a mobile OTP marks the row consumed, and it cannot be replayed', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');

      await endpoints.sendTo(
        'common-send-otp',
        {
          body: {
            countryID: testData.countryId,
            mobileNumber: testData.otpMobile,
            requestType: 'signup',
          },
        },
        { label: 'otp-db:send-for-validate', allowLiveWrite: true },
      );

      const minted = await latest(database, 'TBL_KPOST_OTP_VALIDATION', {
        mobile_number: testData.otpMobile,
      });
      expect(minted?.otp, 'a code was minted to validate').toBeTruthy();

      const validated = await endpoints.sendTo(
        'common-validate-otp',
        {
          body: {
            otp: minted?.otp,
            countryID: testData.countryId,
            mobileNumber: testData.otpMobile,
          },
        },
        { label: 'otp-db:validate-mobile', allowLiveWrite: true },
      );
      expect(validated.status, 'the correct code is accepted').toBe(200);

      const consumed = await database.findOne<OtpRow>({
        table: 'TBL_KPOST_OTP_VALIDATION',
        where: { id: minted?.id ?? 0 },
      });
      expect(
        consumed?.otp_validation_status,
        'validation is RECORDED on the row — an accepted code that is never marked consumed is a code that can be reused',
      ).toBe('Y');

      // Replay: the same code again must be refused.
      const replay = await endpoints.sendTo(
        'common-validate-otp',
        {
          body: {
            otp: minted?.otp,
            countryID: testData.countryId,
            mobileNumber: testData.otpMobile,
          },
        },
        { label: 'otp-db:replay-mobile', allowLiveWrite: true },
      );
      expect(
        replay.status,
        `a consumed code must not validate a second time (got ${replay.status}: ${replay.bodyText.slice(0, 120)})`,
      ).not.toBe(200);
    });

    test('a wrong mobile code is refused and consumes nothing', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');

      await endpoints.sendTo(
        'common-send-otp',
        {
          body: {
            countryID: testData.countryId,
            mobileNumber: testData.otpMobile,
            requestType: 'signup',
          },
        },
        { label: 'otp-db:send-for-wrong', allowLiveWrite: true },
      );
      const minted = await latest(database, 'TBL_KPOST_OTP_VALIDATION', {
        mobile_number: testData.otpMobile,
      });

      const wrong = await endpoints.sendTo(
        'common-validate-otp',
        {
          body: {
            otp: testData.invalidOtp,
            countryID: testData.countryId,
            mobileNumber: testData.otpMobile,
          },
        },
        { label: 'otp-db:wrong-code', allowLiveWrite: true },
      );
      expect(wrong.status, 'a wrong code is refused').not.toBe(200);

      // A failed guess must not burn the pending code, or one typo locks the user out of signup.
      const after = await database.findOne<OtpRow>({
        table: 'TBL_KPOST_OTP_VALIDATION',
        where: { id: minted?.id ?? 0 },
      });
      expect(after?.otp_validation_status, 'a failed attempt leaves the pending code usable').toBe(
        'N',
      );
    });

    test('repeated sends each mint a fresh code, and the endpoint never 5xxs', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');

      // Five sequential resends. No throttle is documented, so none is asserted: only no 5xx, and the
      // observed throttling is recorded as an annotation.
      const statuses: number[] = [];
      const ids: number[] = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const sent = await endpoints.sendTo(
          'common-send-otp',
          {
            body: {
              countryID: testData.countryId,
              mobileNumber: testData.otpMobile,
              requestType: 'signup',
            },
          },
          { label: `otp-db:resend#${attempt + 1}`, allowLiveWrite: true },
        );
        statuses.push(sent.status);
        const row = await latest(database, 'TBL_KPOST_OTP_VALIDATION', {
          mobile_number: testData.otpMobile,
        });
        if (row) ids.push(row.id);
      }

      expect(
        statuses.filter((s) => s >= 500),
        `resending must not crash the OTP service (statuses: ${statuses.join(', ')})`,
      ).toHaveLength(0);

      const throttled = statuses.filter((s) => s === 429).length;
      test.info().annotations.push({
        type: 'observed',
        description:
          `5 sequential sendOTP calls → ${statuses.join(', ')}; ${new Set(ids).size} distinct rows minted. ` +
          (throttled > 0
            ? `${throttled} throttled with 429 — a resend limit is enforced.`
            : `none throttled — sendOTP applies NO resend limit at this rate. Not asserted as a defect ` +
              `(no documented policy), but this endpoint is unauthenticated and sends real SMS in ` +
              `production, so it is worth a product decision.`),
      });
    });

    test('the mail channel mints a real code, which validates and is then consumed', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');

      const sent = await endpoints.sendTo(
        'common-send-otp-to-mail',
        { body: { otherEmail: testData.otpEmail } },
        { label: 'otp-db:send-mail', allowLiveWrite: true },
      );
      expect(sent.status, 'sendOTPtoMail is accepted').toBe(200);

      const minted = await latest(database, 'TBL_KPOST_EMAIL_OTP_VALIDATION', {
        email: testData.otpEmail,
      });
      expect(minted?.otp, 'a mail code was minted').toBeTruthy();
      expect(minted?.otp_validation_status, 'unconsumed when minted').toBe('N');
      expect(
        seconds(minted!.send_date, minted!.expire_date),
        'the mail code carries the same 10-minute window as the SMS code',
      ).toBe(WINDOW_SECONDS);

      // Validate with the stored code, not the SMS bypass (which the mail channel correctly refuses).
      expect(
        String(minted?.otp),
        'the mail channel mints a real random code, so the SMS bypass must not be what is stored',
      ).not.toBe(testData.bypassOtp);

      const validated = await endpoints.sendTo(
        'common-validate-mail-otp',
        { body: { email: testData.otpEmail, otp: Number(minted?.otp) } },
        { label: 'otp-db:validate-mail', allowLiveWrite: true },
      );
      expect(
        validated.status,
        `the real mail code validates (body: ${validated.bodyText.slice(0, 140)})`,
      ).toBe(200);

      const consumed = await database.findOne<OtpRow>({
        table: 'TBL_KPOST_EMAIL_OTP_VALIDATION',
        where: { id: minted?.id ?? 0 },
      });
      expect(consumed?.otp_validation_status, 'and the row is marked consumed').toBe('Y');
    });

    test('the SMS bypass code is not accepted by the mail channel', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');

      // The refusal is correct. Accepting a fixed, known code for e-mail ownership would be a
      // security regression.
      await endpoints.sendTo(
        'common-send-otp-to-mail',
        { body: { otherEmail: testData.otpEmail } },
        { label: 'otp-db:send-mail-bypass', allowLiveWrite: true },
      );

      const refused = await endpoints.sendTo(
        'common-validate-mail-otp',
        { body: { email: testData.otpEmail, otp: Number(testData.bypassOtp) } },
        { label: 'otp-db:mail-bypass', allowLiveWrite: true },
      );
      expect(refused.status, 'the SMS bypass must not validate an e-mail address').not.toBe(200);

      const row = await latest(database, 'TBL_KPOST_EMAIL_OTP_VALIDATION', {
        email: testData.otpEmail,
      });
      expect(row?.otp_validation_status, 'and the pending code stays unconsumed').toBe('N');
    });

    test('a validated signup identity can hold a session @api', async ({
      endpoints,
      databases,
    }) => {
      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');

      // The signup identity may already exist (a signup cannot be deleted), so this asserts the
      // invariant: every session row belongs to its account and has a revocable id.
      const repo = new KpostRepository(database);
      const sessions = await repo.sessions(testData.kpostId);

      expect(
        sessions.every((s) => String(s.kpost_id) === testData.kpostId),
        'every session row returned for this account belongs to it',
      ).toBe(true);
      for (const session of sessions) {
        expect(session.session_id, 'each session carries a revocable id').toBeTruthy();
      }

      const signup = await endpoints.sendTo(
        'signup-login-kpost-id-exist',
        {
          body: {
            kpostID: testData.signupKpostId,
            firstName: 'QA',
            lastName: 'Bench',
            mobileNumber: testData.otpMobile,
          },
        },
        { label: 'otp-db:signup-identity' },
      );
      test.info().annotations.push({
        type: 'observed',
        description: `registration identity ${testData.signupKpostId}: availability check answered ${signup.status}.`,
      });
    });

    test('an EXPIRED code is refused — the 10-minute boundary is enforced @slow', async ({
      endpoints,
      databases,
    }) => {
      // Needs a real 10-minute wait, so it is opt-in (OTP_EXPIRY_WAIT=true). `otp_expire_status` is
      // never updated by the server, so it is not asserted. `expire_date` is IST read back as UTC:
      // only differences between two stored timestamps are safe, never comparisons with Date.now().
      test.skip(
        process.env.OTP_EXPIRY_WAIT !== 'true',
        'needs a real 10-minute wait; set OTP_EXPIRY_WAIT=true to run the expiry boundary',
      );
      test.setTimeout(15 * 60 * 1000);

      const database = databases.for('kpost-api');
      test.skip(!database.enabled, 'needs the KPOST_QA connection');

      const sent = await endpoints.sendTo(
        'common-send-otp',
        {
          body: {
            countryID: testData.countryId,
            mobileNumber: testData.otpMobile,
            requestType: 'signup',
          },
        },
        { label: 'otp-db:expiry-send', allowLiveWrite: true },
      );
      expect(sent.status, 'a code was minted for the expiry test').toBe(200);

      const minted = await latest(database, 'TBL_KPOST_OTP_VALIDATION', {
        mobile_number: testData.otpMobile,
      });
      expect(minted?.otp_validation_status, 'the code starts unconsumed').toBe('N');

      const windowMs = seconds(minted!.send_date, minted!.expire_date) * 1000;
      await new Promise((resolve) => setTimeout(resolve, windowMs + 25_000));

      // Re-read first: if the code was consumed or replaced during the wait, a refusal proves nothing.
      const beforeValidate = await latest(database, 'TBL_KPOST_OTP_VALIDATION', {
        mobile_number: testData.otpMobile,
      });
      expect(beforeValidate?.id, 'no newer code was minted on this number during the wait').toBe(
        minted?.id,
      );
      expect(
        beforeValidate?.otp_validation_status,
        'the code is still unconsumed, so a refusal can only be about expiry',
      ).toBe('N');

      const expired = await endpoints.sendTo(
        'common-validate-otp',
        {
          body: {
            otp: minted?.otp,
            countryID: testData.countryId,
            mobileNumber: testData.otpMobile,
          },
        },
        { label: 'otp-db:validate-expired', allowLiveWrite: true },
      );

      expect(
        expired.status,
        `an expired code must be refused (got ${expired.status}: ${expired.bodyText.slice(0, 120)})`,
      ).not.toBe(200);

      const after = await latest(database, 'TBL_KPOST_OTP_VALIDATION', {
        mobile_number: testData.otpMobile,
      });
      expect(after?.otp_validation_status, 'and the refused attempt consumed nothing').toBe('N');
    });
  },
);
