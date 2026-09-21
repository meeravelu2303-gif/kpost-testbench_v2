/**
 * Deciding whether a signup actually created an account.
 *
 * ## Why this is not "the request returned 2xx"
 *
 * An HTTP code says the request was accepted, not that an account exists. This repository has been
 * bitten by exactly that gap before — a mail SEND endpoint tagged as satisfying "read receipts", a UI
 * catalogue marking "open state" as built — and an account registry built on a status code would
 * quietly fill with accounts that were never created. Worse, it would be undetectable: the next run
 * would try to reuse one and fail to authenticate, which reads as an application defect.
 *
 * So confirmation needs APPLICATION evidence. On this product that evidence already exists and is
 * already registered: `kpostIdExist` answers whether an id is available, and the decision log records
 * both answers being used to prove an account's existence (`200 "Available. can be used"` versus
 * `400 "already exits!"`). Asking it before and after the signup is what distinguishes:
 *
 *     available → taken     the signup created it            CONFIRMED
 *     taken     → taken     it already existed               ALREADY_EXISTS  (not ours to claim)
 *     available → available accepted, but nothing was made   AMBIGUOUS
 *
 * ## Pure by design
 *
 * It takes plain values and returns a decision. It sends nothing, so it is fully testable offline,
 * and the direction stays one-way: the signup flow calls this and then the registry; neither knows
 * about the other.
 */

/** What `kpostIdExist` said about an id. `UNKNOWN` when the check was not made or did not answer. */
export type IdAvailability = 'AVAILABLE' | 'TAKEN' | 'UNKNOWN';

export const SIGNUP_OUTCOMES = [
  /** Application evidence shows the account now exists and did not before. */
  'CONFIRMED',
  /** The id was already taken before the attempt — the account is not this run's to record. */
  'ALREADY_EXISTS',
  /** The application refused the request. No account was created. */
  'REJECTED',
  /** Not established either way. Never registered, never silently discarded. */
  'AMBIGUOUS',
] as const;
export type SignupOutcome = (typeof SIGNUP_OUTCOMES)[number];

export interface SignupEvidence {
  /** HTTP status of the signup call. `0` when nothing answered. */
  readonly signupStatus: number;
  /** The KPost envelope's own `status` string, when the body carried one. */
  readonly envelopeStatus?: string;
  /** True when no response was received at all. */
  readonly transportFailed?: boolean;
  /** Whether the id was available BEFORE the attempt. */
  readonly availabilityBefore: IdAvailability;
  /** Whether the id was available AFTER it. */
  readonly availabilityAfter: IdAvailability;
}

export interface SignupAssessment {
  readonly outcome: SignupOutcome;
  /** Whether the registry may record an account. True only for `CONFIRMED`. */
  readonly shouldRegister: boolean;
  /** Why, in terms a reviewer can check against the evidence. */
  readonly reason: string;
}

/**
 * Assesses signup evidence.
 *
 * Deliberately conservative: every path that is not positively established returns `AMBIGUOUS` with
 * `shouldRegister: false`. An account wrongly absent from the registry costs one re-run; an account
 * wrongly present is a permanent lie about a deployment, because KPOST cannot delete it.
 */
export function assessSignup(evidence: SignupEvidence): SignupAssessment {
  if (evidence.transportFailed || evidence.signupStatus === 0) {
    return {
      outcome: 'AMBIGUOUS',
      shouldRegister: false,
      reason:
        'no response was received, so whether the account was created is unknown — a timeout after ' +
        'the server committed looks identical to one before it',
    };
  }

  if (evidence.signupStatus >= 500) {
    return {
      outcome: 'AMBIGUOUS',
      shouldRegister: false,
      reason: `signup answered ${evidence.signupStatus}; a server error leaves creation undetermined`,
    };
  }

  // A pre-existing id means the account is not this attempt's, whatever the response says.
  if (evidence.availabilityBefore === 'TAKEN') {
    return {
      outcome: 'ALREADY_EXISTS',
      shouldRegister: false,
      reason:
        'the id was already taken before the attempt, so this run did not create it. Registering it ' +
        'would claim an account the bench may not own.',
    };
  }

  if (evidence.signupStatus >= 400) {
    return {
      outcome: 'REJECTED',
      shouldRegister: false,
      reason: `signup answered ${evidence.signupStatus}; the application refused the request`,
    };
  }

  if (evidence.availabilityAfter === 'TAKEN' && evidence.availabilityBefore === 'AVAILABLE') {
    return {
      outcome: 'CONFIRMED',
      shouldRegister: true,
      reason:
        'the id was available before the attempt and is taken after it, and signup answered ' +
        `${evidence.signupStatus} — the account exists and this run created it`,
    };
  }

  if (evidence.availabilityAfter === 'AVAILABLE') {
    return {
      outcome: 'AMBIGUOUS',
      shouldRegister: false,
      reason:
        `signup answered ${evidence.signupStatus} but the id is still reported available, so no ` +
        'account can be confirmed. Accepting the status code alone here is exactly the mistake this ' +
        'check exists to prevent.',
    };
  }

  return {
    outcome: 'AMBIGUOUS',
    shouldRegister: false,
    reason:
      'the existence check did not answer, so creation is unconfirmed. The attempt is recorded ' +
      'rather than registered or discarded.',
  };
}

/** Reads `kpostIdExist`'s answer. 200 means available on this product; 400 means already taken. */
export function availabilityFromExistCheck(status: number): IdAvailability {
  if (status === 200) return 'AVAILABLE';
  if (status === 400 || status === 409) return 'TAKEN';
  return 'UNKNOWN';
}
