import { apiRegistry } from '@api/definitions/index';
import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isActorRoleId } from '../../src/actors/index';
import { hasRequirement } from '../../src/requirements/index';
import * as stateModule from '../../src/states/index';
import {
  EVIDENCE_STATUSES,
  FORBIDDEN_OBSERVATION_KEYS,
  STATE_CONFLICTS,
  STATE_OBSERVATIONS,
  STATE_RESOURCES,
  STATE_TRANSITIONS,
  STATE_VOCABULARIES,
  allStateIds,
  assertValidStateModel,
  conflictsOf,
  hasState,
  observationsOf,
  referencedEndpointIds,
  referencedRequirementIds,
  state,
  statesOf,
  transitionsInto,
  transitionsOf,
  undriveableTransitions,
  unobservableStates,
  validateStateModel,
  vocabulary,
} from '../../src/states/index';

/**
 * Guards for Phase 4B — the Application State Model.
 *
 * ## What these prove
 *
 * That every declared state, transition and observation carries checkable provenance; that every
 * endpoint, requirement and actor reference resolves against the registry that owns it; that an
 * observation cannot claim a runtime value; that conflicts survive as conflicts; and that the module
 * sits beside the existing architecture without touching it.
 *
 * ## What they deliberately do NOT do
 *
 * They execute no HTTP, need no live KPOST environment, and assert nothing about what state any
 * resource is actually in — that is a runtime fact this model is forbidden from holding.
 */

/** Source files of this module, for the architecture guards. */
const STATE_SOURCES = [
  'provenance.ts',
  'vocabulary.ts',
  'transition.ts',
  'observation.ts',
  'conflict.ts',
  'registry.ts',
  'validate.ts',
  'index.ts',
  'catalogue/katchup-message.ts',
  'catalogue/kall.ts',
  'catalogue/kmail-transaction.ts',
  'catalogue/conflicts.ts',
] as const;

const stateSource = (file: string): string =>
  readFileSync(path.join(ROOT_DIR, 'src', 'states', file), 'utf8');

/** Layers the State Model must stay independent of. */
const FORBIDDEN_IMPORTS = [
  'bug-tracker',
  'failure-analysis',
  'reporting',
  'validators',
  'validation-engine',
  'api/client',
  'api/definitions',
  'test-data',
  'playwright',
  'database',
  'flows',
] as const;

/** Anything whose presence would mean the State Model had started deciding permissions. */
const PERMISSION_TOKENS = [
  'canSend',
  'canRead',
  'canRecall',
  'canEdit',
  'canDelete',
  'canAdmin',
  'isAllowed',
  'hasPermission',
] as const;

/** Every declared state, flattened once so no test body has to loop twice. */
const ALL_STATES = STATE_VOCABULARIES.flatMap((v) => v.states);

// ---------------------------------------------------------------------------------------------
// 1. State vocabulary
// ---------------------------------------------------------------------------------------------

test.describe('state model: vocabulary @framework', () => {
  test('the declared model is internally consistent', () => {
    // The single strongest guard here: every structural rule in validate.ts, applied to real data.
    expect(validateStateModel()).toEqual([]);
    expect(() => assertValidStateModel()).not.toThrow();
  });

  test('exactly the three evidence-backed resource families are modelled', () => {
    expect([...STATE_RESOURCES]).toEqual(['katchup.message', 'kall', 'kmail.transaction']);
    expect(STATE_VOCABULARIES.map((v) => v.resource)).toEqual([...STATE_RESOURCES]);
    // Group is excluded on purpose: the documented API has no group read endpoint, so a declared
    // group state could never be confirmed.
    expect(vocabulary('group')).toBeUndefined();
    expect(vocabulary('kdiary.event')).toBeUndefined();
  });

  test('every state resolves and carries usable provenance', () => {
    for (const definition of ALL_STATES) {
      expect(hasState(definition.stateId), definition.stateId).toBe(true);
      expect(state(definition.stateId), definition.stateId).toBe(definition);
      expect(EVIDENCE_STATUSES, definition.stateId).toContain(definition.provenance.status);
      expect(definition.provenance.citation.trim(), definition.stateId).not.toBe('');
    }
  });

  test('an unknown state reference is rejected', () => {
    expect(hasState('katchup.message.invented')).toBe(false);
    expect(state('kall.teleported')).toBeUndefined();
    expect(observationsOf('nope.not.a.state')).toEqual([]);
    expect(transitionsInto('nope.not.a.state')).toEqual([]);
  });

  test('the katchupStatus overload is preserved, not normalised away', () => {
    // 4 "Group" classifies the row; 0-3 describe the lifecycle. Recording them all as one enum
    // would imply a group message can be Read through this field, which it cannot.
    const groupRow = state('katchup.message.group-row');
    expect(groupRow?.role).toBe('CLASSIFIER');
    expect(groupRow?.provenance.status).toBe('CONFLICTED');
    expect(state('katchup.message.read')?.role).toBe('LIFECYCLE');
    // Both live on the same field — which is the whole problem, and stays visible.
    expect(groupRow?.field).toBe('status');
    expect(state('katchup.message.read')?.field).toBe('status');
    expect(conflictsOf('katchup.message').map((c) => c.conflictId)).toContain(
      'CONF-KATCHUP-STATUS-OVERLOADED',
    );
  });

  test('literal terminology is kept verbatim, in each source’s own spelling', () => {
    // Not re-cased, not unified: "ReScheduled" and "Not sent" are how the sources spell them.
    expect(state('kall.rescheduled')?.term).toBe('ReScheduled');
    expect(state('katchup.message.not-sent')?.term).toBe('Not sent');
    // Numeric codes stay strings so 0 and "0" remain distinguishable.
    expect(state('kall.scheduled')?.rawValue).toBe('6');
    expect(state('kmail.transaction.read')?.rawValue).toBe('Y | N');
    // Three different representations coexist rather than being flattened to one.
    const representations = new Set(ALL_STATES.map((s) => s.representation));
    expect(representations.has('NUMERIC_CODE')).toBe(true);
    expect(representations.has('YN_FLAG')).toBe(true);
    expect(representations.has('TIMESTAMP_PRESENCE')).toBe(true);
  });

  test('a state nothing documents is recorded as UNKNOWN rather than given a meaning', () => {
    for (const stateId of ['kall.removed', 'kall.koolkall-accepted', 'kall.not-joined']) {
      expect(state(stateId)?.role, stateId).toBe('UNKNOWN');
      expect(state(stateId)?.provenance.status, stateId).toBe('UNKNOWN');
    }
  });

  test('an inference is marked DERIVED, never DOCUMENTED', () => {
    // There is no "edited" field; the repository infers it from messageType 6.
    expect(state('katchup.message.edited')?.provenance.status).toBe('DERIVED');
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Transitions
// ---------------------------------------------------------------------------------------------

test.describe('state model: transitions @framework', () => {
  test('every transition references declared states', () => {
    // `from: null` means the action creates the resource, so only non-null origins are looked up.
    // Filtered outside the assertion to keep the test body free of conditionals.
    const origins = STATE_TRANSITIONS.filter((t) => t.from !== null);
    expect(origins.length).toBeGreaterThan(0);
    for (const transition of origins) {
      expect(hasState(transition.from ?? ''), transition.transitionId).toBe(true);
    }
    for (const transition of STATE_TRANSITIONS) {
      expect(hasState(transition.to), transition.transitionId).toBe(true);
    }
  });

  test('every actor reference resolves in the Phase 3 role registry', () => {
    const withActor = STATE_TRANSITIONS.filter((t) => t.actor !== undefined);
    expect(withActor.length).toBeGreaterThan(0);
    for (const transition of withActor) {
      expect(isActorRoleId(transition.actor ?? ''), transition.transitionId).toBe(true);
    }
  });

  test('every requirement reference resolves in the Phase 1 registry', () => {
    const ids = referencedRequirementIds();
    expect(ids.length).toBeGreaterThan(0);
    for (const requirementId of ids) {
      expect(hasRequirement(requirementId), requirementId).toBe(true);
    }
  });

  test('an unregistered requirement id would be rejected', () => {
    // BR-* ids are business rules, not Phase 1 requirements; they belong in provenance text.
    expect(hasRequirement('BR-C01')).toBe(false);
    expect(hasRequirement('BR-K03')).toBe(false);
    expect(referencedRequirementIds()).not.toContain('BR-C01');
  });

  test('a transition the bench cannot drive says why, and names no endpoint', () => {
    const undriveable = undriveableTransitions();
    expect(undriveable.length).toBeGreaterThan(0);
    for (const { transition, reason } of undriveable) {
      expect(reason.trim(), transition.transitionId).not.toBe('');
      expect(transition.endpointId, transition.transitionId).toBeUndefined();
    }
  });

  test('the 1:1 read transition is UI-driven while its state stays observable', () => {
    // The Phase 4A distinction, encoded: no endpoint CAUSES the read, but the resulting state is
    // returned by a conversation read that runs on live.
    const read = STATE_TRANSITIONS.find((t) => t.transitionId === 'katchup.message.read');
    expect(read?.mechanism).toBe('UI');
    expect(read?.endpointId).toBeUndefined();
    expect(read?.actor).toBe('recipient');
    expect(read?.unavailableReason).toContain('No endpoint marks a 1:1 Katchup message read');

    const observations = observationsOf('katchup.message.read');
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.some((o) => o.runsOnLive)).toBe(true);
  });

  test('no transition targets a CLASSIFIER state', () => {
    for (const transition of STATE_TRANSITIONS) {
      expect(state(transition.to)?.role, transition.transitionId).not.toBe('CLASSIFIER');
    }
  });

  test('transitions carry no permission logic', () => {
    const serialised = JSON.stringify(STATE_TRANSITIONS).toLowerCase();
    for (const token of PERMISSION_TOKENS) {
      expect(serialised, token).not.toContain(token.toLowerCase());
    }
    for (const transition of STATE_TRANSITIONS) {
      for (const value of Object.values(transition)) {
        expect(typeof value, transition.transitionId).not.toBe('function');
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Observations
// ---------------------------------------------------------------------------------------------

test.describe('state model: observations @framework', () => {
  test('every referenced endpoint id resolves in the API registry', () => {
    // The one place the state layer and the API layer are allowed to meet — exactly as the Flow
    // Model does it, so `src/states/` itself never imports the registry.
    const registered = new Set(apiRegistry.all().map((endpoint) => endpoint.id));
    const referenced = referencedEndpointIds();
    expect(referenced.length).toBeGreaterThan(0);
    for (const endpointId of referenced) {
      expect(registered.has(endpointId), endpointId).toBe(true);
    }
  });

  test('every observation names an explicit field path and the states it reveals', () => {
    for (const observation of STATE_OBSERVATIONS) {
      expect(observation.fieldPath.trim(), observation.observationId).not.toBe('');
      expect(observation.observes.length, observation.observationId).toBeGreaterThan(0);
      for (const stateId of observation.observes) {
        expect(hasState(stateId), `${observation.observationId} → ${stateId}`).toBe(true);
      }
    }
  });

  test('an observation cannot claim a runtime value', () => {
    // Structural, not conventional. This is the boundary the whole type exists to defend.
    for (const observation of STATE_OBSERVATIONS) {
      const keys = Object.keys(observation);
      for (const forbidden of FORBIDDEN_OBSERVATION_KEYS) {
        expect(keys, `${observation.observationId} carries ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  test('live applicability is represented, and is not uniform', () => {
    for (const observation of STATE_OBSERVATIONS) {
      expect(typeof observation.runsOnLive, observation.observationId).toBe('boolean');
    }
    // Both kinds exist: some observations are available on the default pass, some need a gated
    // lifecycle for a runtime id. A model where everything were `true` would be wrong.
    expect(STATE_OBSERVATIONS.some((o) => o.runsOnLive)).toBe(true);
    expect(STATE_OBSERVATIONS.some((o) => !o.runsOnLive)).toBe(true);
  });

  test('states with no observation mechanism are reported rather than hidden', () => {
    const unobservable = unobservableStates().map((s) => s.stateId);
    // A measurement, not a failure — but it must be answerable, and the three undocumented Kall
    // codes must be in it, since nothing can observe a state nobody has described.
    expect(unobservable).toContain('kall.removed');
    expect(unobservable).toContain('kall.not-joined');
  });

  test('the conversation read is recorded as the live-available Katchup state observation', () => {
    const observation = STATE_OBSERVATIONS.find(
      (o) => o.observationId === 'katchup.message.lifecycle-via-conversation',
    );
    expect(observation?.endpointId).toBe('katchup-conversation');
    expect(observation?.fieldPath).toBe('data[].status');
    expect(observation?.runsOnLive).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Conflicts
// ---------------------------------------------------------------------------------------------

test.describe('state model: conflicts @framework', () => {
  test('every conflict keeps at least two cited positions', () => {
    expect(STATE_CONFLICTS.length).toBeGreaterThan(0);
    for (const conflict of STATE_CONFLICTS) {
      expect(conflict.positions.length, conflict.conflictId).toBeGreaterThanOrEqual(2);
      for (const position of conflict.positions) {
        expect(position.claim.trim(), conflict.conflictId).not.toBe('');
        expect(position.citation.trim(), conflict.conflictId).not.toBe('');
      }
      expect(conflict.resolutionRequires.trim(), conflict.conflictId).not.toBe('');
    }
  });

  test('no conflict can be marked resolved', () => {
    // There is deliberately no RESOLVED member: settling one of these needs new evidence, not an
    // edit. A resolved conflict is removed and its claim promoted, which leaves a trail.
    expect([...stateModule.STATE_CONFLICT_STATUSES]).toEqual(['UNRESOLVED']);
    for (const conflict of STATE_CONFLICTS) {
      expect(conflict.status, conflict.conflictId).toBe('UNRESOLVED');
    }
  });

  test('the BR-C01 transition dispute keeps both sides', () => {
    const conflict = STATE_CONFLICTS.find((c) => c.conflictId === 'CONF-KALL-BR-C01');
    expect(conflict?.kind).toBe('TRANSITION_CLAIM');
    const claims = (conflict?.positions ?? []).map((p) => p.claim).join(' ');
    expect(claims).toContain('observed on live');
    expect(claims).toContain('stays 6');
    // The transition itself still exists and is marked CONFLICTED — it is not deleted because the
    // sources disagree about whether the build performs it.
    const transition = STATE_TRANSITIONS.find((t) => t.transitionId === 'kall.reschedule');
    expect(transition?.provenance.status).toBe('CONFLICTED');
    expect(transition?.to).toBe('kall.rescheduled');
  });

  test('the read-perspective question stays open', () => {
    const conflict = STATE_CONFLICTS.find((c) => c.conflictId === 'CONF-KATCHUP-READ-PERSPECTIVE');
    expect(conflict?.positions.length).toBe(2);
    expect(conflict?.resolutionRequires).toContain('gated live observation');
    // No sender/recipient assumption is encoded in the state itself.
    expect(state('katchup.message.read-time-recorded')?.provenance.note).toContain('UNKNOWN');
  });

  test('a cross-resource conflict is visible from every resource it touches', () => {
    const parity = STATE_CONFLICTS.find((c) => c.conflictId === 'CONF-XMODULE-RECEIPT-PARITY');
    expect(parity?.resource).toBeNull();
    for (const resource of STATE_RESOURCES) {
      expect(
        conflictsOf(resource).map((c) => c.conflictId),
        resource,
      ).toContain('CONF-XMODULE-RECEIPT-PARITY');
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Isolation — the registry is read-only and deterministic
// ---------------------------------------------------------------------------------------------

test.describe('state model: isolation @framework', () => {
  test('the registry is deterministic: repeated queries are identical', () => {
    expect(statesOf('kall')).toEqual(statesOf('kall'));
    expect(transitionsOf('katchup.message')).toEqual(transitionsOf('katchup.message'));
    expect(referencedEndpointIds()).toEqual(referencedEndpointIds());
    expect(allStateIds()).toEqual(allStateIds());
  });

  test('the top-level collections are frozen', () => {
    expect(Object.isFrozen(STATE_VOCABULARIES)).toBe(true);
    expect(Object.isFrozen(STATE_TRANSITIONS)).toBe(true);
    expect(Object.isFrozen(STATE_OBSERVATIONS)).toBe(true);
  });

  test('a returned collection cannot corrupt the registry', () => {
    const before = statesOf('kall').length;
    const copy = [...statesOf('kall')];
    copy.pop();
    expect(statesOf('kall')).toHaveLength(before);
  });

  test('the module holds no mutable state — nothing is recorded between calls', () => {
    const first = unobservableStates().map((s) => s.stateId);
    const second = unobservableStates().map((s) => s.stateId);
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------------------------
// 6. Architecture
// ---------------------------------------------------------------------------------------------

test.describe('state model: architecture @framework', () => {
  test('the module imports nothing from execution, Bugzilla, confidence or reporting', () => {
    for (const file of STATE_SOURCES) {
      const imports = [...stateSource(file).matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '');
      for (const specifier of imports) {
        for (const forbidden of FORBIDDEN_IMPORTS) {
          expect(specifier, `${file} imports ${specifier}`).not.toContain(forbidden);
        }
      }
    }
  });

  test('the module contains no authorization logic', () => {
    for (const file of STATE_SOURCES) {
      // Strip comments: the files DISCUSS why permissions are absent, and that prose must not be
      // mistaken for the thing it forbids.
      const code = stateSource(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const token of PERMISSION_TOKENS) {
        expect(code, `${file} defines ${token}`).not.toContain(token);
      }
    }
  });

  test('the module replaces neither the resource ledger nor FlowRun state', () => {
    // Different subjects, deliberately kept apart: CLEANED means the BENCH removed a record it
    // created; deletedBy means the APPLICATION marked a resource deleted for a party.
    const declared = new Set(allStateIds());
    for (const ledgerState of ['REGISTERED', 'CLEANUP_PENDING', 'CLEANED', 'CLEANUP_FAILED']) {
      expect(declared.has(ledgerState), ledgerState).toBe(false);
    }
    for (const flowStatus of ['NOT_EXECUTED', 'BLOCKED', 'SKIPPED', 'PASSED', 'FAILED']) {
      expect(declared.has(flowStatus), flowStatus).toBe(false);
    }
    const terms = new Set(ALL_STATES.map((s) => s.term));
    expect(terms.has('CLEANED')).toBe(false);
    expect(terms.has('BLOCKED')).toBe(false);
  });

  test('the public surface is descriptive only', () => {
    const exported = Object.keys(stateModule);
    // Nothing that could execute, assert or advance anything.
    for (const forbidden of ['execute', 'run', 'advance', 'apply', 'assertState', 'verify']) {
      expect(exported, forbidden).not.toContain(forbidden);
    }
  });
});
