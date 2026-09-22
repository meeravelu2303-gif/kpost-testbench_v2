/**
 * The switch that holds the KMail suite back while the host refuses every valid token.
 *
 * ## Why a gate rather than deleting or `.skip`-ing each spec
 *
 * `testkmail.kpostindia.com` currently answers `401 "Unauthorized: UNAUTHORIZED USER"` to a token
 * KPost itself accepts — a verified server-side regression, evidenced in
 * `tests/api/kmail/auth-regression.spec.ts` and recorded in CLAUDE.md §8. Until it is fixed, every
 * KMail spec fails, and not for its own reason: a content-type check fails because the 401 body is
 * HTML, a security-header check fails on an error page, every negative probe "fails" because it got
 * 401 rather than the 400 it expected.
 *
 * That noise is actively harmful. It buries the one real fault, it triples the module's runtime
 * (the 3-pass reproduction gate re-runs each failure), and if filing were on it would create a
 * ticket per consequence of a single root cause.
 *
 * So the specs stay written, wired and reviewed — they simply do not execute. `KMAIL_AUTH_FIXED=true`
 * turns the whole suite back on in one step, with no code change, the moment the developers land the
 * fix. The intent is a **pause**, not a retreat: nothing here is weakened to make it pass.
 *
 * The auth-regression spec is deliberately NOT gated — it is the one that proves the defect is still
 * live, and it is what will tell us the fix has landed.
 */

/** True when the owner has confirmed KMail authentication works again. */
export function kmailAuthFixed(): boolean {
  return process.env.KMAIL_AUTH_FIXED === 'true';
}

/**
 * The reason a KMail spec is not running, or undefined when it should.
 *
 * Phrased for whoever reads the run output: it names the blocker, says it is tracked, and says
 * exactly which variable re-enables the suite — so a skipped KMail module is never mistaken for
 * missing coverage.
 */
export function kmailAuthGate(): string | undefined {
  if (kmailAuthFixed()) return undefined;
  return (
    'Skipped pending Bugzilla ticket fix for KMail 401 Unauthorized issue. ' +
    'testkmail rejects every valid KPost token (see tests/api/kmail/auth-regression.spec.ts); ' +
    'set KMAIL_AUTH_FIXED=true to re-enable the whole KMail suite.'
  );
}
