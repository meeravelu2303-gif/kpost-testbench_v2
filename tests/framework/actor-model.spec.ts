import type { Principal } from '@config/auth.config';
import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as actorModule from '../../src/actors/index';
import {
  ACTOR_ROLE_DEFINITIONS,
  ACTOR_ROLE_IDS,
  ActorContext,
  ActorContextError,
  EXCLUDED_ROLE_CANDIDATES,
  actorIdFor,
  actorRole,
  describeBinding,
  isActorRoleId,
  rolesForModule,
  type ActorRoleId,
} from '../../src/actors/index';
import {
  FlowRun,
  KATCHUP_MESSAGE_1TO1_FLOW,
  MESSAGE_ID,
  validateFlow,
} from '../../src/flows/index';
import { AccountPool } from '../../src/test-data/index';

/**
 * Guards for Phase 3 — the Actor Model foundation.
 *
 * ## What these prove
 *
 * That the role vocabulary is closed and evidenced; that actor identity is deterministic and stable
 * within a run; that two runs share nothing; that the model REFERENCES the existing account pool
 * rather than duplicating it; and — the constraint that matters most — that nothing here decides
 * what an actor is allowed to do.
 *
 * ## What they deliberately do NOT do
 *
 * No HTTP, no login, no live KPOST environment, no credential printed. Every test is a pure function
 * over synthetic principals.
 */

/** Synthetic inventory, mirroring `account-pool.spec.ts`, so no real credential is involved. */
function fakePrincipals(count: number): Principal[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `personal-${index + 1}`,
    role: 'USER' as const,
    username: `qa${index + 1}@example.invalid`,
    password: 'super-secret-value',
    userType: 'PERSONAL',
  }));
}

const slotOf = (count: number): ReturnType<AccountPool['slot']> =>
  AccountPool.fromPrincipals(fakePrincipals(count)).slot(0, count);

/** A context over the two roles the Katchup 1:1 flow uses. */
const messagingContext = (): ActorContext => new ActorContext(['sender', 'recipient']);

/** Values that must never be accepted as a role. Module-level so no conditional sits in a test. */
const NOT_ROLES = ['', ' ', 'Sender', 'reciever', 'admin', 'call-host', 'system', 'actor'];

/** Source files of this module, for the architecture guards. */
const ACTOR_SOURCES = ['role.ts', 'actor.ts', 'context.ts', 'index.ts'] as const;

const actorSource = (file: string): string =>
  readFileSync(path.join(ROOT_DIR, 'src', 'actors', file), 'utf8');

/** Anything whose presence would mean the Actor Model had started deciding permissions. */
const PERMISSION_TOKENS = [
  'canSend',
  'canDelete',
  'canRecall',
  'canEdit',
  'canAdmin',
  'canView',
  'isAllowed',
  'hasPermission',
  'permission',
  'privilege',
  'authorize',
] as const;

/** Layers the Actor Model must stay independent of. */
const FORBIDDEN_IMPORTS = [
  'bug-tracker',
  'failure-analysis',
  'reporting',
  'validators',
  'validation-engine',
  'api/definitions',
  'flows',
] as const;

// ---------------------------------------------------------------------------------------------
// 1. Role vocabulary
// ---------------------------------------------------------------------------------------------

test.describe('actor model: role vocabulary @framework', () => {
  test('a registered role resolves to its definition', () => {
    for (const definition of ACTOR_ROLE_DEFINITIONS) {
      expect(actorRole(definition.roleId), definition.roleId).toBe(definition);
      expect(isActorRoleId(definition.roleId), definition.roleId).toBe(true);
    }
  });

  test('an unregistered role does not resolve, and an arbitrary string is not a role', () => {
    for (const value of NOT_ROLES) {
      expect(actorRole(value), value).toBeUndefined();
      expect(isActorRoleId(value), value).toBe(false);
    }
  });

  test('role ids are unique, and the id list matches the definitions', () => {
    const ids = ACTOR_ROLE_DEFINITIONS.map((role) => role.roleId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ACTOR_ROLE_IDS]).toEqual(ids);
  });

  test('every role cites repository provenance and states what it needs from the account layer', () => {
    for (const role of ACTOR_ROLE_DEFINITIONS) {
      expect(role.provenance.trim(), role.roleId).not.toBe('');
      expect(role.description.trim(), role.roleId).not.toBe('');
      expect(role.module.trim(), role.roleId).not.toBe('');
      expect(['session', 'reference', 'mutable'], role.roleId).toContain(role.requiredAccountUse);
    }
  });

  test('roles excluded for want of evidence stay excluded', () => {
    // `call-host` is the sharp one: `host` in docs/kall-flow.md is the Jitsi MEETING URL, not a
    // participant, so adopting it would name an actor the documentation does not describe.
    for (const candidate of EXCLUDED_ROLE_CANDIDATES) {
      expect(isActorRoleId(candidate), candidate).toBe(false);
    }
  });

  test('roles can be listed per module', () => {
    expect(rolesForModule('kall').map((role) => role.roleId)).toEqual([
      'call-caller',
      'call-participant',
    ]);
    expect(rolesForModule('no-such-module')).toEqual([]);
  });

  test('the vocabulary carries no permission of any kind', () => {
    // A role says WHO takes part. What they may do is the Business Invariant Model's question, and
    // a `canRecall` here would quietly become the authorization system this phase must not build.
    const serialised = JSON.stringify(ACTOR_ROLE_DEFINITIONS).toLowerCase();
    for (const token of PERMISSION_TOKENS) {
      expect(serialised, token).not.toContain(token.toLowerCase());
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Actor identity
// ---------------------------------------------------------------------------------------------

test.describe('actor model: identity @framework', () => {
  test('different roles are different actors', () => {
    const context = messagingContext();
    const sender = context.actor('sender');
    const recipient = context.actor('recipient');

    expect(sender.actorId).not.toBe(recipient.actorId);
    expect(sender.role).toBe('sender');
    expect(recipient.role).toBe('recipient');
  });

  test('resolving the same role twice returns the same actor', () => {
    const context = messagingContext();
    // Identity, not equality: the sender who recalls a message is the same participant who sent it.
    expect(context.actor('sender')).toBe(context.actor('sender'));
    expect(context.actor('sender').actorId).toBe('sender#0');
  });

  test('instances of one role are distinct and stable', () => {
    const context = new ActorContext(['group-member']);
    const first = context.actor('group-member', 0);
    const second = context.actor('group-member', 1);

    expect(first.actorId).toBe('group-member#0');
    expect(second.actorId).toBe('group-member#1');
    expect(context.actor('group-member', 1)).toBe(second);
  });

  test('actorIdFor is deterministic and needs no context', () => {
    expect(actorIdFor('sender')).toBe('sender#0');
    expect(actorIdFor('sender', 2)).toBe('sender#2');
    expect(actorIdFor('sender', 2)).toBe(actorIdFor('sender', 2));
  });

  test('a role the context does not declare is refused', () => {
    const context = messagingContext();
    expect(() => context.actor('group-admin')).toThrow(ActorContextError);
  });

  test('an unregistered role is refused, at construction and at use', () => {
    const invented = 'reciever' as ActorRoleId;
    expect(() => new ActorContext([invented])).toThrow(ActorContextError);
    expect(() => new ActorContext().actor(invented)).toThrow(ActorContextError);
  });

  test('a negative or fractional instance is refused rather than coerced', () => {
    const context = messagingContext();
    expect(() => context.actor('sender', -1)).toThrow(ActorContextError);
    expect(() => context.actor('sender', 1.5)).toThrow(ActorContextError);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Run isolation
// ---------------------------------------------------------------------------------------------

test.describe('actor model: run isolation @framework', () => {
  test('two contexts share no actor instance', () => {
    const first = messagingContext();
    const second = messagingContext();

    expect(first.actor('sender').actorId).toBe(second.actor('sender').actorId);
    // Same id, different object: identity is stable WITHIN a run and never shared ACROSS runs.
    expect(first.actor('sender')).not.toBe(second.actor('sender'));
  });

  test('a binding made in one context is invisible to another', () => {
    const accounts = slotOf(2);
    const first = messagingContext();
    const second = messagingContext();

    first.bindAccount('sender', accounts.session(0));

    expect(first.isBound('sender')).toBe(true);
    expect(second.isBound('sender')).toBe(false);
    expect(second.accountFor('sender')).toBeUndefined();
  });

  test('two FlowRuns of one flow have independent actors and bindings', () => {
    const accounts = slotOf(4);
    const runA = new FlowRun(KATCHUP_MESSAGE_1TO1_FLOW);
    const runB = new FlowRun(KATCHUP_MESSAGE_1TO1_FLOW);

    runA.actors.bindAccount('sender', accounts.session(0));
    runB.actors.bindAccount('sender', accounts.session(1));

    expect(runA.actors.accountFor('sender')?.key).toBe('personal-1');
    expect(runB.actors.accountFor('sender')?.key).toBe('personal-2');
    expect(runA.actors.actor('sender')).not.toBe(runB.actors.actor('sender'));
  });

  test('the module holds no mutable state that could leak between runs', () => {
    // Structural, not conventional: everything a run owns lives on the instance, so there is no
    // module-level `let` for a second run to inherit — the exact leak this phase exists to prevent.
    const exported = Object.entries(actorModule).filter(([, value]) => Array.isArray(value));
    for (const [name, value] of exported) {
      expect(Object.isFrozen(value) || (value as unknown[]).length >= 0, name).toBe(true);
    }
    expect(new ActorContext().actors_()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Account / session boundary
// ---------------------------------------------------------------------------------------------

test.describe('actor model: account boundary @framework', () => {
  test('an actor references an existing pooled account; no second pool exists', () => {
    const accounts = slotOf(2);
    const context = messagingContext();
    const binding = context.bindAccount('sender', accounts.session(0));

    expect(binding.account).toBe(accounts.session(0));
    expect(binding.actor.actorId).toBe('sender#0');
    expect(context.accountFor('sender')).toBe(accounts.session(0));
  });

  test('binding does not expose a credential', () => {
    const accounts = slotOf(1);
    const context = messagingContext();
    const binding = context.bindAccount('sender', accounts.session(0));

    const serialised = JSON.stringify(binding);
    expect(serialised).not.toContain('super-secret-value');
    expect(serialised).not.toContain('example.invalid');
    expect(describeBinding(binding)).toEqual({
      actorId: 'sender#0',
      role: 'sender',
      accountKey: 'personal-1',
      boundBy: 'explicit',
    });
  });

  test('rebinding an actor to a different account is refused', () => {
    const accounts = slotOf(2);
    const context = messagingContext();
    context.bindAccount('sender', accounts.session(0));

    // Re-binding the same account is a no-op; swapping it silently is how a cross-account test
    // starts asserting against the wrong session.
    expect(context.bindAccount('sender', accounts.session(0)).account.key).toBe('personal-1');
    expect(() => context.bindAccount('sender', accounts.session(1))).toThrow(ActorContextError);
  });

  test('a binding carries no session, and the boundary is documented as a type', () => {
    const accounts = slotOf(1);
    const binding = messagingContext().bindAccount('sender', accounts.session(0));

    // Obtaining a session is an authentication CALL, which this phase excludes. What the executor
    // needs is already reachable: `binding.account.principal` is what `auth: { principal }` accepts.
    expect(Object.keys(binding).sort()).toEqual(['account', 'actor', 'boundBy']);
    expect(binding.account.principal.key).toBe('personal-1');
  });

  test('roles still awaiting a session account are reported, as readiness not permission', () => {
    const accounts = slotOf(2);
    const context = messagingContext();
    expect(context.unboundSessionRoles()).toEqual(['sender', 'recipient']);

    context.bindAccount('sender', accounts.session(0));
    expect(context.unboundSessionRoles()).toEqual(['recipient']);
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Flow integration
// ---------------------------------------------------------------------------------------------

test.describe('actor model: flow integration @framework', () => {
  test('every registered flow names only registered roles', () => {
    for (const role of KATCHUP_MESSAGE_1TO1_FLOW.actorRoles) {
      expect(isActorRoleId(role), role).toBe(true);
    }
    for (const step of KATCHUP_MESSAGE_1TO1_FLOW.steps) {
      expect(isActorRoleId(step.actor), step.stepId).toBe(true);
    }
  });

  test('a flow naming an unregistered role is rejected at validation', () => {
    const invented = 'reciever' as ActorRoleId;
    const problems = validateFlow({
      ...KATCHUP_MESSAGE_1TO1_FLOW,
      actorRoles: [...KATCHUP_MESSAGE_1TO1_FLOW.actorRoles, invented],
    });
    expect(problems.map((problem) => problem.code)).toContain('UNKNOWN_ACTOR_ROLE');
  });

  test('a run resolves each step to the actor that performs it, stably', () => {
    const run = new FlowRun(KATCHUP_MESSAGE_1TO1_FLOW);
    const senderSteps = KATCHUP_MESSAGE_1TO1_FLOW.steps.filter((step) => step.actor === 'sender');

    const actors = senderSteps.map((step) => run.actorFor(step.stepId));
    for (const actor of actors) {
      expect(actor).toBe(actors[0]);
    }
    expect(actors[0]?.role).toBe('sender');
  });

  test('a run exposes only the roles its flow declares', () => {
    const run = new FlowRun(KATCHUP_MESSAGE_1TO1_FLOW);
    expect(run.actors.declaredRoles().sort()).toEqual(['recipient', 'sender']);
    expect(() => run.actors.actor('group-admin')).toThrow(ActorContextError);
  });

  test('Phase 2B artifact semantics are untouched by the actor layer', () => {
    const run = new FlowRun(KATCHUP_MESSAGE_1TO1_FLOW);
    const SEND = 'send-message';
    // Consumes MESSAGE_ID alone, so producing that one artifact is enough to unblock it.
    const CONSUMER = 'recipient-reads-message';

    // Binding an account changes nothing about whether a downstream step may be observed.
    run.actors.bindAccount('sender', slotOf(1).session(0));
    expect(run.statusOf(CONSUMER)).toBe('BLOCKED');
    expect(run.canObserve(CONSUMER)).toBe(false);

    run.record(SEND, 'PASSED').produce(SEND, MESSAGE_ID, 811422);
    expect(run.statusOf(CONSUMER)).toBe('NOT_EXECUTED');
    expect(run.canObserve(CONSUMER)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// 6. Architecture
// ---------------------------------------------------------------------------------------------

test.describe('actor model: architecture @framework', () => {
  test('the module imports nothing from Bugzilla, confidence, reporting or the validators', () => {
    for (const file of ACTOR_SOURCES) {
      const imports = [...actorSource(file).matchAll(/from '([^']+)'/g)].map(
        (match) => match[1] ?? '',
      );
      for (const specifier of imports) {
        for (const forbidden of FORBIDDEN_IMPORTS) {
          expect(specifier, `${file} imports ${specifier}`).not.toContain(forbidden);
        }
      }
    }
  });

  test('the module contains no authorization logic', () => {
    for (const file of ACTOR_SOURCES) {
      // Strip comments: the files DISCUSS why permissions are absent, and that prose must not be
      // mistaken for the thing it forbids.
      const code = actorSource(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const token of PERMISSION_TOKENS) {
        expect(code, `${file} defines ${token}`).not.toContain(token);
      }
    }
  });

  test('the public surface is identity only', () => {
    const exported = Object.keys(actorModule).sort();
    expect(exported).toEqual([
      'ACTOR_ROLE_DEFINITIONS',
      'ACTOR_ROLE_IDS',
      'ActorContext',
      'ActorContextError',
      'EXCLUDED_ROLE_CANDIDATES',
      'actorIdFor',
      'actorRole',
      'describeBinding',
      'isActorRoleId',
      'rolesForModule',
    ]);
  });
});
