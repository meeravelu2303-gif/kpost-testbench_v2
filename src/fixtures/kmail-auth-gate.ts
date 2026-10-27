/**
 * Holds the KMail suite back while the host refuses valid tokens (known defect, see
 * `tests/kmail-api/security/auth-regression.spec.ts`, which is not gated). `KMAIL_AUTH_FIXED=true` turns it
 * back on.
 */

/** True when the owner has confirmed KMail authentication works again. */
export function kmailAuthFixed(): boolean {
  return process.env.KMAIL_AUTH_FIXED === 'true';
}

/** Why a KMail spec is not running (naming the variable that re-enables it), or undefined. */
export function kmailAuthGate(): string | undefined {
  if (kmailAuthFixed()) return undefined;
  return (
    'Skipped pending Bugzilla ticket fix for KMail 401 Unauthorized issue. ' +
    'testkmail rejects every valid KPost token (see tests/kmail-api/security/auth-regression.spec.ts); ' +
    'set KMAIL_AUTH_FIXED=true to re-enable the whole KMail suite.'
  );
}
