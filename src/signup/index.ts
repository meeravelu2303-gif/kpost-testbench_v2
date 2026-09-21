/**
 * Signup-side reasoning about whether an account was actually created.
 *
 * Deliberately tiny, and deliberately NOT part of the account registry: the registry must not know
 * what signup is, so that any future flow which mints an account can use it unchanged. The direction
 * is one-way —
 *
 *     signup flow  ──►  assessSignup()  ──►  AccountRegistry.register()
 *
 * This module contains no HTTP, no Playwright and no signup implementation. It interprets evidence a
 * caller has already gathered.
 */
export {
  SIGNUP_OUTCOMES,
  assessSignup,
  availabilityFromExistCheck,
  type IdAvailability,
  type SignupAssessment,
  type SignupEvidence,
  type SignupOutcome,
} from './account-confirmation';
