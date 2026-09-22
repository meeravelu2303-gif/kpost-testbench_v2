import { testData } from '@config/test-data.config';
import type { DatabaseClient } from '@database/database-client';
import { KpostRepository } from '@database/repositories/kpost.repository';
import { expect, test } from '@fixtures';

/**
 * OTP lifecycle asserted where the token actually lives: generation → validation → replay → expiry
 * boundary → resend behaviour, each checked against `TBL_KPOST_OTP_VALIDATION` (mobile) and
 * `TBL_KPOST_EMAIL_OTP_VALIDATION` (e-mail).
 *
 * ## Why the database and not the response
 *
 * An OTP endpoint that answers SUCCESS tells you nothing about the token it minted. The security
 * properties of a one-time code are all row-level facts: that it exists, that it carries an expiry,
 * that consuming it marks it consumed, and that a consumed or expired code cannot be replayed. Every
 * one of those is invisible from `{"status":"SUCCESS"}`.
 *
 * ## The gateway bypass is SMS-ONLY — measured, not assumed
 *
 * The mobile channel on this test database stores the literal bypass code:
 *
 *   TBL_KPOST_OTP_VALIDATION        mobile 9000000777 → otp "123456"
 *
 * The mail channel does NOT. It stores a real random code and sends it:
 *
 *   TBL_KPOST_EMAIL_OTP_VALIDATION  qa.bench+otp@kpost.in → otp "490949"
 *
 * The bench previously sent `123456` to `validateMailOTP` and read the resulting 500 as a product
 * defect. It is not: the code was simply wrong, and the endpoint refused it correctly. Verified both
 * ways — the real stored code validates (200, row flips to 'Y'), the bypass code does not.
 *
 * So the mail half reads its code from the row it just caused to be written. That is legitimate here
 * and only here: this is the disposable TEST database, which the bench is authorised to read, and it
 * is the only way to exercise the mail path end to end without a mailbox.
 *
 * ## Safety
 *
 * Runs only on a confirmed test gateway. Every identity is an allowlisted QA fixture, so nothing is
 * sent to a real person's number or mailbox. No account is created or modified: these tests generate
 * and consume codes against the reserved registration identity only.
 */
test.describe('KPost OTP · lifecycle with MySQL assertions @database', { tag: '@api' }, () => {
  test.describe.configure({ mode: 'serial' });

  test.skip(
    process.env.OTP_TEST_GATEWAY !== 'true' || process.env.TEST_DB_MODE !== 'true',
    'OTP flows run only on a confirmed test gateway: OTP_TEST_GATEWAY=true + TEST_DB_MODE=true',
  );

  /*
   * Every test here mints codes against `otpMobile`, NEVER `signupMobile`.
   *
   * Those are two reserved numbers and the distinction is load-bearing: `otp-signup-lifecycle.spec.ts`
   * drives the registration chain on `signupMobile`, and a code is consumed by whoever validates it
   * first. Sharing one number made both specs pass alone and fail together — seven tests failed in a
   * full run while passing 7/7 in isolation, because each spec was validating a code the other had
   * just replaced. Splitting the numbers is what makes them independent.
   *
   * Within this file the describe is `mode: 'serial'`, so its own tests cannot race each other for
   * the number either — which the expiry test depends on, since it asserts that nothing minted a
   * newer code while it waited.
   */
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

  /*
   * The most recently minted row for a destination.
   *
   * Sorted here rather than in SQL because  exposes only  +  — deliberately,
   * so every bench query is a simple equality lookup the safety guards can reason about. The result
   * sets are a handful of rows for one reserved test identity, so ordering them in memory costs
   * nothing.
   */
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

    /*
     * Freshly minted means BOTH flags clear. A code born 'Y' would be pre-consumed; a code born
     * expired would be unusable. Asserted separately so a failure says which.
     */
    expect(row?.otp_validation_status, 'a new code is unconsumed').toBe('N');
    expect(row?.otp_expire_status, 'and not yet expired').toBe('N');

    /*
     * The expiry is the security property: a code with no bound is a permanent password. The window
     * is asserted against the value the API advertises in its own response message rather than a
     * number invented here.
     */
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

    /*
     * The replay. This is the whole point of "one-time": the same code, immediately again, must be
     * refused. If it were accepted, an intercepted SMS would be reusable for the rest of its window.
     */
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

  test('a wrong mobile code is refused and consumes nothing', async ({ endpoints, databases }) => {
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

    /*
     * And it must not burn the real one. A failed guess that marks the pending code consumed is a
     * denial-of-service on the user's own signup: they receive a code, someone fat-fingers one
     * attempt, and the code they were sent silently stops working.
     */
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

    /*
     * The resend path, which is where a lockout would live if one existed. Five sequential requests
     * — enough to show whether a limit is applied, small enough not to flood a shared gateway.
     *
     * No specific throttle is asserted, because none is documented and inventing one ("expect the
     * 4th to fail") would fail a correct product. What IS asserted is the floor that holds either
     * way: every attempt is answered without a server error, and each accepted send leaves a
     * distinct, unconsumed code rather than reusing one.
     */
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
      statuses.filter((s) => s >= 500).length,
      `resending must not crash the OTP service (statuses: ${statuses.join(', ')})`,
    ).toBe(0);

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

    /*
     * The code the server actually stored — NOT the SMS bypass. Sending `123456` here is refused,
     * which is correct behaviour and was previously mistaken for a defect.
     */
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

    /*
     * Pinned as its own test because it is the mistake this suite was built to stop repeating: the
     * bench assumed one gateway bypass covered both channels, sent `123456` to the mail validator,
     * and filed the refusal as a product 500. The refusal is correct. If a future build DOES start
     * accepting the bypass on the mail channel, that is a genuine security regression — a fixed,
     * publicly known code validating e-mail ownership — and this turns red for it.
     */
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

  test('a validated signup identity can hold a session @api', async ({ endpoints, databases }) => {
    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    /*
     * The other half of the task: a session row, not just a token. The registration identity may or
     * may not already exist on the disposable database (a signup cannot be deleted, so a re-run is
     * "already exists"), so this asserts the INVARIANT rather than a specific account — every
     * session row belongs to the account that owns it, and carries what a revocation needs.
     */
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
    /*
     * The boundary itself, which needs a real ten-minute wait, so it is opt-in:
     * OTP_EXPIRY_WAIT=true. Every other test here runs in milliseconds and a ten-minute case in the
     * default run would get skipped or deleted by the first person in a hurry.
     *
     * MEASURED 2026-09-22 (this is what the test pins, not a guess):
     *   minted  id 16616, code 123456, otp_validation_status 'N', 600s window
     *   waited  625s — the server (not the client clock) confirmed 24s past expire_date
     *   POST /v2/common/validateOTP/ with the correct, unconsumed, expired code -> HTTP 500
     *           {"message":"OTP validation failed"}
     *   row after: still 'N' / 'N'
     *
     * So expiry IS enforced. The code was refused on the strength of expire_date alone.
     *
     * ## Two things this measurement settled that guesswork would not have
     *
     * 1. `otp_expire_status` is NOT maintained. The server rejected this code FOR BEING EXPIRED and
     *    still left the flag 'N'. Across the table, 3,237 of 3,238 rows flagged 'N' are past their
     *    expire_date. Enforcement reads the TIMESTAMP, so this is stale bookkeeping rather than a
     *    security hole — but nothing should ever trust that column, and no test here asserts on it
     *    as a source of truth.
     *
     * 2. Times must be compared BY THE DATABASE. `expire_date` is stored as IST wall-clock and comes
     *    back through the driver as if it were UTC, so JS date arithmetic against `Date.now()` is
     *    off by 5.5 hours — a first attempt at this test computed a NEGATIVE wait, slept for the
     *    minimum, validated a perfectly live code and would have "proved" expiry was enforced
     *    without ever reaching the boundary. Differences between two stored timestamps are safe
     *    (the offset cancels, which is why the window assertions above are sound); comparisons
     *    against "now" are not.
     */
    test.skip(
      process.env.OTP_EXPIRY_WAIT !== 'true',
      'needs a real 10-minute wait; set OTP_EXPIRY_WAIT=true to run the expiry boundary',
    );
    test.setTimeout(15 * 60 * 1000);

    const database = databases.for('kpost-api');
    test.skip(!database.enabled, 'needs the KPOST_QA connection');

    /*
     * Sent to `otpMobile`, deliberately NOT the `signupMobile` every other test here uses. Those
     * tests mint and consume codes on that number constantly, and an earlier run of this very check
     * was invalidated by one of them consuming the code mid-wait — the refusal that came back was
     * then a replay refusal wearing an expiry refusal's clothes.
     */
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

    /*
     * Re-read before validating. If anything consumed the code while we waited, the refusal below
     * would be a REPLAY refusal and would say nothing about expiry — so the test states that
     * plainly instead of quietly passing on the wrong evidence.
     */
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

    /*
     * The security property: a code past its window must not work, however correct it is. If this
     * ever returns 200, a one-time code has become a permanent one.
     */
    expect(
      expired.status,
      `an expired code must be refused (got ${expired.status}: ${expired.bodyText.slice(0, 120)})`,
    ).not.toBe(200);

    const after = await latest(database, 'TBL_KPOST_OTP_VALIDATION', {
      mobile_number: testData.otpMobile,
    });
    expect(after?.otp_validation_status, 'and the refused attempt consumed nothing').toBe('N');
  });
});
