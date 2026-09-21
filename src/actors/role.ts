import type { AccountUse } from '../test-data/account-pool';

/**
 * ActorRole — the semantic role a participant plays in a business flow.
 *
 * Phase 3. This module answers **WHO** performs or observes a business action. It deliberately does
 * NOT answer what that participant is allowed to do: there is no permission, no capability and no
 * business rule anywhere in this module, and none may be added. Authorization belongs to the future
 * Business Invariant Model.
 *
 * ## Why a closed vocabulary rather than free strings
 *
 * Phase 2B let a `FlowStep` name its actor with any string, so every new flow could invent a role and
 * nothing could tell `recipient` from `reciever`. The vocabulary below is closed, so a typo is a
 * compile error and the set of roles the bench understands is one reviewable list.
 *
 * ## Provenance rule
 *
 * Every role is evidenced by something already in the repository, cited in `provenance`. Roles were
 * NOT invented to look complete — see the two candidates recorded as excluded at the bottom of this
 * file, and the report accompanying this phase.
 */

/**
 * What a role needs from the account infrastructure in order to play its part.
 *
 * Reuses the existing `AccountUse` vocabulary (`src/test-data/account-pool.ts`) rather than
 * inventing a parallel one:
 *
 *  - `session`   — the bench must LOG IN as this actor (it acts, or it observes its own view)
 *  - `reference` — the actor is only named in a payload; no login needed
 *
 * This is infrastructure, not permission. It says whether a token is required to play the role, not
 * what the role may do once it has one. Phase 2A found this distinction load-bearing: a Katchup
 * recipient that must *observe* needs a session, whereas one that is merely addressed does not.
 */
export interface ActorRoleDefinition {
  roleId: string;
  /** One line on the part this role plays. Never a permission. */
  description: string;
  /** The module whose documented flow evidences the role. */
  module: string;
  /** Where in THIS repository the role is evidenced, so a reviewer can check it. */
  provenance: string;
  /** What the role needs from the account layer to participate. Infrastructure, not authorization. */
  requiredAccountUse: AccountUse;
}

/**
 * The roles the repository documents today.
 *
 * Katchup and KMail share the four messaging roles deliberately rather than carrying
 * `mail-sender` / `mail-recipient` duplicates: the repository documents the SAME recipient model for
 * both — Katchup's `revealContactList` / `hiddenContactList` and KMail's `ccList` / `bccList` are the
 * visible-copy and confidential-copy channels of one concept — and CLAUDE.md §2 (BR-X01) states read
 * receipts behave identically across the two modules. A role is a semantic part, not a module label;
 * if a genuine behavioural difference is ever documented, a module-specific role can be added then.
 */
export const ACTOR_ROLE_DEFINITIONS = [
  {
    roleId: 'sender',
    description: 'Originates a message and performs the sender-side actions on it.',
    module: 'katchup',
    provenance: 'docs/katchup-flow.md §4 "SENDER ACTIONS (Bell menu, FR-K08..K20)"',
    requiredAccountUse: 'session',
  },
  {
    roleId: 'recipient',
    description: 'Receives a message addressed to them directly (the TO recipient).',
    module: 'katchup',
    provenance: 'docs/katchup-flow.md §4 "RECIPIENT ACTIONS (Reply menu, FR-K21..K25)"',
    requiredAccountUse: 'session',
  },
  {
    roleId: 'copy-recipient',
    description: 'Receives a visible copy; the other recipients can see they were copied.',
    module: 'katchup',
    provenance:
      'docs/katchup-flow.md line 155 (Cc / Confidential Copy, messageType 14); ' +
      'revealContactList in tests/api/kpost/katchup/feature.spec.ts:333',
    requiredAccountUse: 'session',
  },
  {
    roleId: 'confidential-copy-recipient',
    description:
      'Receives a confidential copy; the other recipients must not be able to see they were copied.',
    module: 'katchup',
    provenance:
      'docs/katchup-flow.md line 110 (hidden from the others, NFR-SEC02); ' +
      'hiddenContactList in tests/api/kpost/katchup/feature.spec.ts:334',
    requiredAccountUse: 'session',
  },
  {
    roleId: 'group-admin',
    description: 'A group member holding admin rights over the group.',
    module: 'group',
    provenance:
      "hasAdminAccess: 'Y' in tests/api/kpost/katchup/feature.spec.ts:224; " +
      'docs/business-rules.md (FR-GM-014 min-one-admin)',
    requiredAccountUse: 'session',
  },
  {
    roleId: 'group-member',
    description: 'A group member without admin rights.',
    module: 'group',
    provenance: "hasAdminAccess: 'N' in tests/api/kpost/katchup/feature.spec.ts:215",
    requiredAccountUse: 'session',
  },
  {
    roleId: 'call-caller',
    description: 'Places or schedules a call.',
    module: 'kall',
    provenance:
      'docs/kall-flow.md line 16 ("kallStatus (sender & receiver)") and line 32 (initiateKall); ' +
      'tests/api/kpost/kall/feature.spec.ts:59 ("the caller’s own log")',
    requiredAccountUse: 'session',
  },
  {
    roleId: 'call-participant',
    description: 'Is called, or is invited to a scheduled call.',
    module: 'kall',
    provenance: 'docs/kall-flow.md line 54 ("kallDetails is the participant list")',
    requiredAccountUse: 'session',
  },
  // `satisfies`, NOT a `: readonly ActorRoleDefinition[]` annotation. An annotation would widen every
  // roleId back to `string`, and `ActorRoleId` — derived from this array — would silently become
  // `string` too, so a flow could name any role and still compile. `satisfies` checks the shape while
  // keeping the literals, which is what makes the vocabulary closed.
] as const satisfies readonly ActorRoleDefinition[];

/**
 * Candidates deliberately NOT added, recorded so the omission is a decision rather than an oversight.
 *
 *  - **`call-host`** — suggested, but `host` in this repository denotes the Jitsi MEETING URL
 *    (`docs/kall-flow.md` line 58: "`www.jitsi.com` is the meeting host"), not a participant. Adding
 *    it would name an actor the documentation does not describe. `call-caller` carries the evidenced
 *    meaning.
 *  - **`system`** — no step in any documented flow is performed by a non-human actor today. It would
 *    be a role with no referent, and an unused member of a closed vocabulary invites misuse. Add it
 *    when a documented flow needs one (a scheduler expiring a disappearing message is the likely
 *    first case, and its semantics are currently uncertain).
 */
export const EXCLUDED_ROLE_CANDIDATES = ['call-host', 'system'] as const;

/** The closed set of role ids. A value outside it is not a role. */
export const ACTOR_ROLE_IDS = ACTOR_ROLE_DEFINITIONS.map(
  (role) => role.roleId,
) as readonly string[];

/**
 * The role-id type.
 *
 * Derived from the definitions so the list and the type cannot drift: adding a definition extends
 * the type, and a typo in a flow is a compile error rather than a silent new role.
 */
export type ActorRoleId = (typeof ACTOR_ROLE_DEFINITIONS)[number]['roleId'];

/** Keyed by plain `string` so an arbitrary value can be *asked about* without first being a role. */
const BY_ID: ReadonlyMap<string, ActorRoleDefinition> = new Map(
  ACTOR_ROLE_DEFINITIONS.map((role) => [role.roleId, role]),
);

/** A role definition, or `undefined` when the id is not a registered role. */
export function actorRole(roleId: string): ActorRoleDefinition | undefined {
  return BY_ID.get(roleId);
}

/** Type guard: whether an arbitrary string is a registered role id. */
export function isActorRoleId(value: string): value is ActorRoleId {
  return BY_ID.has(value);
}

/** Roles belonging to one module. */
export function rolesForModule(module: string): ActorRoleDefinition[] {
  return ACTOR_ROLE_DEFINITIONS.filter((role) => role.module === module);
}
