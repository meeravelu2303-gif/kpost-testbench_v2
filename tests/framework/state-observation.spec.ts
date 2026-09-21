import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as observationModule from '../../src/state-observation/index';
import {
  FORBIDDEN_RESULT_KEYS,
  FieldPathError,
  StateObservationError,
  observationIdsForEndpoint,
  observationsForResource,
  observeBody,
  observeExchange,
  parseFieldPath,
  requireObservationDefinition,
  unidentifiedObservations,
  type ObservableExchange,
  type StateObservation,
} from '../../src/state-observation/index';
import { STATE_OBSERVATIONS, vocabulary } from '../../src/states/index';

/**
 * Guards for Phase 4C — the State Observation Foundation.
 *
 * ## What these prove
 *
 * That a captured response yields state values attached to the RIGHT resource; that null, absent and
 * present stay three distinct facts; that the raw value survives untouched; that an observation
 * references the evidence instead of copying the response; and that nothing here decides whether a
 * value is correct.
 *
 * ## What they deliberately do NOT do
 *
 * No HTTP, no live KPOST, and not one assertion about what a state SHOULD be. Every fixture below is
 * synthetic and deterministic.
 */

// ---------------------------------------------------------------------------------------------
// Synthetic fixtures — shaped after the documented response examples, with invented ids.
// ---------------------------------------------------------------------------------------------

/**
 * A 1:1 Katchup conversation. Deliberately mixed:
 *  - 8247 Sent, readTime explicitly null
 *  - 8101 Read, readTime populated
 *  - 8055 carries NO readTime key at all (absent ≠ null)
 *  - 8020 carries the markers
 */
const KATCHUP_CONVERSATION = {
  firstMsgID: 8020,
  lastMsgID: 8247,
  status: 'SUCCESS',
  statusCode: 200,
  data: [
    {
      msgID: 8247,
      sender: 'qa.one@example.invalid',
      receiver: 'qa.two@example.invalid',
      status: 0,
      readTime: null,
      deletedBy: null,
      importantBy: null,
      isVanished: false,
      secretMessageExpireTime: null,
    },
    {
      msgID: 8101,
      sender: 'qa.one@example.invalid',
      receiver: 'qa.two@example.invalid',
      status: 2,
      readTime: '2026-09-19T16:53:23.000+00:00',
      deletedBy: null,
      importantBy: null,
      isVanished: false,
      secretMessageExpireTime: null,
    },
    {
      // No readTime key whatsoever.
      msgID: 8055,
      sender: 'qa.two@example.invalid',
      receiver: 'qa.one@example.invalid',
      status: 1,
    },
    {
      msgID: 8020,
      sender: 'qa.one@example.invalid',
      receiver: 'qa.two@example.invalid',
      status: 2,
      readTime: '2026-09-18T09:00:00.000+00:00',
      deletedBy: 'qa.two@example.invalid',
      importantBy: 'qa.one@example.invalid',
      isVanished: true,
      secretMessageExpireTime: 1790000000000,
    },
  ],
};

/** Two calls, each with two participants — the nested-array case. */
const KALL_TODAY_KOOL = {
  status: 'SUCCESS',
  statusCode: 200,
  data: [
    {
      kallID: 901,
      senderKallStatus: 6,
      deletedBySender: false,
      kallDetails: [
        {
          id: 11,
          receiver: 'qa.two@example.invalid',
          receiverKallStatus: 6,
          joinStatus: false,
          deleteStatus: false,
        },
        {
          id: 12,
          receiver: 'qa.three@example.invalid',
          receiverKallStatus: 8,
          joinStatus: true,
          deleteStatus: false,
        },
      ],
    },
    {
      kallID: 902,
      senderKallStatus: 8,
      deletedBySender: true,
      kallDetails: [
        {
          id: 21,
          receiver: 'qa.two@example.invalid',
          receiverKallStatus: 0,
          joinStatus: true,
          deleteStatus: true,
        },
      ],
    },
  ],
};

/** One mail, two recipient transactions — object-then-array. */
const KMAIL_MAIL_CONTENT = {
  status: 'SUCCESS',
  value: {
    kmailID: 3301,
    groupFlag: false,
    kmailTransactionList: [
      {
        transactionID: 71,
        receiver: 'qa.two@example.invalid',
        receiverType: 1,
        deliveryStatus: 'Y',
        readStatus: 'Y',
        replyStatus: 'N',
        deleteBySender: 'N',
        deleteByReceiver: 'N',
        letterReadTime: 1790000111000,
      },
      {
        transactionID: 72,
        receiver: 'qa.three@example.invalid',
        receiverType: 2,
        deliveryStatus: 'Y',
        readStatus: 'N',
        replyStatus: 'N',
        deleteBySender: 'N',
        deleteByReceiver: 'N',
        letterReadTime: null,
      },
    ],
  },
};

/** Two mails, each with a transaction — array-then-array, the sentMailNotOpened shape. */
const KMAIL_SENT_NOT_OPENED = {
  status: 'SUCCESS',
  value: [
    {
      kmailID: 4001,
      kmailTransactionList: [
        {
          transactionID: 81,
          receiver: 'qa.two@example.invalid',
          deliveryStatus: 'Y',
          readStatus: 'N',
        },
      ],
    },
    {
      kmailID: 4002,
      kmailTransactionList: [
        {
          transactionID: 82,
          receiver: 'qa.three@example.invalid',
          deliveryStatus: 'Y',
          readStatus: 'Y',
        },
      ],
    },
  ],
};

const CONTEXT = { correlationId: 'tb-0000-test', runId: 'run-1', testCaseId: 'TC-TEST-1' };

const observe = (observationId: string, body: unknown, extra = {}): StateObservation[] =>
  observeBody(body, {
    ...CONTEXT,
    observationId,
    observedAt: '2026-09-20T00:00:00.000Z',
    ...extra,
  });

const byResource = (observations: readonly StateObservation[]): Record<string, unknown> =>
  Object.fromEntries(observations.map((o) => [o.resourceId ?? '(none)', o.rawValue]));

/** Source files, for the architecture guards. */
const SOURCES = ['path.ts', 'observation-result.ts', 'extract.ts', 'index.ts'] as const;
const source = (file: string): string =>
  readFileSync(path.join(ROOT_DIR, 'src', 'state-observation', file), 'utf8');

const FORBIDDEN_IMPORTS = [
  'bug-tracker',
  'failure-analysis',
  'reporting',
  'validators',
  'validation-engine',
  'api/client',
  'api/definitions',
  'playwright',
  'database',
  'flows',
  'test-data',
] as const;

// ---------------------------------------------------------------------------------------------
// 1. Basic extraction
// ---------------------------------------------------------------------------------------------

test.describe('state observation: basic extraction @framework', () => {
  test('a single field is read with its resource id', () => {
    const observations = observe(
      'katchup.message.lifecycle-via-conversation',
      KATCHUP_CONVERSATION,
    );
    expect(observations).toHaveLength(4);

    const first = observations[0];
    expect(first?.resource).toBe('katchup.message');
    expect(first?.resourceId).toBe('8247');
    expect(first?.stateKey).toBe('status');
    expect(first?.rawValue).toBe(0);
    expect(first?.presence).toBe('PRESENT');
    expect(first?.identityPresence).toBe('PRESENT');
    expect(first?.location).toBe('$.data[0].status');
    expect(first?.endpointId).toBe('katchup-conversation');
  });

  test('a response with no matching rows yields no observations, not an error', () => {
    expect(observe('katchup.message.lifecycle-via-conversation', { data: [] })).toEqual([]);
    expect(observe('katchup.message.lifecycle-via-conversation', { status: 'SUCCESS' })).toEqual(
      [],
    );
  });

  test('an unparsed body yields nothing rather than a fabricated absence', () => {
    const broken: ObservableExchange = {
      correlationId: 'tb-broken',
      json: () => ({ ok: false, reason: 'response body is empty' }),
    };
    expect(
      observeExchange(broken, { observationId: 'katchup.message.lifecycle-via-conversation' }),
    ).toEqual([]);
  });

  test('an exchange supplies its own correlation id and label', () => {
    const exchange: ObservableExchange = {
      correlationId: 'tb-from-exchange',
      label: 'primary',
      json: () => ({ ok: true, value: KATCHUP_CONVERSATION }),
    };
    const observations = observeExchange(exchange, {
      observationId: 'katchup.message.lifecycle-via-conversation',
    });
    expect(observations[0]?.correlationId).toBe('tb-from-exchange');
    expect(observations[0]?.label).toBe('primary');
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Multiple resources — values must not cross
// ---------------------------------------------------------------------------------------------

test.describe('state observation: resource correlation @framework', () => {
  test('each value is attached to its own message, not a neighbour', () => {
    const observations = observe(
      'katchup.message.lifecycle-via-conversation',
      KATCHUP_CONVERSATION,
    );
    // The whole point of §5: 8247 is Sent and 8101 is Read, and nothing may swap them.
    expect(byResource(observations)).toEqual({ '8247': 0, '8101': 2, '8055': 1, '8020': 2 });
  });

  test('read times stay with their own message across null, value and absent', () => {
    const observations = observe(
      'katchup.message.read-time-via-conversation',
      KATCHUP_CONVERSATION,
    );
    expect(byResource(observations)).toEqual({
      '8247': null,
      '8101': '2026-09-19T16:53:23.000+00:00',
      '8055': undefined,
      '8020': '2026-09-18T09:00:00.000+00:00',
    });
  });

  test('filtering by resource returns only that resource’s values', () => {
    const observations = observe('katchup.message.markers-via-conversation', KATCHUP_CONVERSATION);
    const forDeleted = observationsForResource(observations, '8020');
    expect(forDeleted).toHaveLength(4);
    expect(new Set(forDeleted.map((o) => o.resourceId))).toEqual(new Set(['8020']));
    expect(forDeleted.find((o) => o.stateKey === 'deletedBy')?.rawValue).toBe(
      'qa.two@example.invalid',
    );
    expect(forDeleted.find((o) => o.stateKey === 'isVanished')?.rawValue).toBe(true);
  });

  test('a row with no identity field is marked unattributed, never guessed', () => {
    const body = { data: [{ status: 2 }, { msgID: 9, status: 0 }] };
    const observations = observe('katchup.message.lifecycle-via-conversation', body);
    expect(observations[0]?.resourceId).toBeUndefined();
    expect(observations[0]?.identityPresence).toBe('ABSENT');
    // Critically: it did NOT inherit 9 from the sibling row.
    expect(observations[1]?.resourceId).toBe('9');
    expect(unidentifiedObservations(observations)).toHaveLength(1);
  });

  test('a null identity is reported as null, not as a missing row', () => {
    const observations = observe('katchup.message.lifecycle-via-conversation', {
      data: [{ msgID: null, status: 2 }],
    });
    expect(observations[0]?.identityPresence).toBe('NULL');
    expect(observations[0]?.resourceId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Nested paths
// ---------------------------------------------------------------------------------------------

test.describe('state observation: nested paths @framework', () => {
  test('a nested participant array keeps each value with its own call', () => {
    const observations = observe('kall.participant-state-via-today-kool', KALL_TODAY_KOOL);
    // 2 calls × (2 + 1) participants × 3 fields.
    expect(observations).toHaveLength(9);

    const statuses = observations.filter((o) => o.stateKey === 'receiverKallStatus');
    // The identity comes from the PARENT call row, since a participant carries no kallID.
    expect(statuses.map((o) => [o.resourceId, o.rawValue])).toEqual([
      ['901', 6],
      ['901', 8],
      ['902', 0],
    ]);
    expect(statuses[0]?.location).toBe('$.data[0].kallDetails[0].receiverKallStatus');
    expect(statuses[2]?.location).toBe('$.data[1].kallDetails[0].receiverKallStatus');
  });

  test('joinStatus and deleteStatus keep their own participant rows', () => {
    const observations = observe('kall.participant-state-via-today-kool', KALL_TODAY_KOOL);
    const joins = observations.filter((o) => o.stateKey === 'joinStatus').map((o) => o.rawValue);
    const deletes = observations
      .filter((o) => o.stateKey === 'deleteStatus')
      .map((o) => o.rawValue);
    expect(joins).toEqual([false, true, true]);
    expect(deletes).toEqual([false, false, true]);
  });

  test('a call-level field reads from the call row itself', () => {
    const observations = observe('kall.status-via-today-kool', KALL_TODAY_KOOL);
    expect(byResource(observations)).toEqual({ '901': 6, '902': 8 });
  });

  test('object-then-array resolves the transaction and its parent mail', () => {
    const observations = observe('kmail.transaction.state-via-mail-content', KMAIL_MAIL_CONTENT);
    const readStatuses = observations.filter((o) => o.stateKey === 'readStatus');
    expect(readStatuses.map((o) => [o.resourceId, o.parentResourceId, o.rawValue])).toEqual([
      ['71', '3301', 'Y'],
      ['72', '3301', 'N'],
    ]);
  });

  test('array-then-array keeps each transaction under its own mail', () => {
    const observations = observe(
      'kmail.transaction.unread-via-sent-not-opened',
      KMAIL_SENT_NOT_OPENED,
    );
    const readStatuses = observations.filter((o) => o.stateKey === 'readStatus');
    expect(readStatuses.map((o) => [o.resourceId, o.parentResourceId, o.rawValue])).toEqual([
      ['81', '4001', 'N'],
      ['82', '4002', 'Y'],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Null vs absent
// ---------------------------------------------------------------------------------------------

test.describe('state observation: null and absent @framework', () => {
  test('explicit null and a missing key are different observations', () => {
    const observations = observe(
      'katchup.message.read-time-via-conversation',
      KATCHUP_CONVERSATION,
    );
    const explicitNull = observations.find((o) => o.resourceId === '8247');
    const missing = observations.find((o) => o.resourceId === '8055');

    expect(explicitNull?.presence).toBe('NULL');
    expect(explicitNull?.rawValue).toBeNull();

    expect(missing?.presence).toBe('ABSENT');
    expect(missing?.rawValue).toBeUndefined();

    // Same field, same endpoint, different facts — and neither is a failure.
    expect(explicitNull?.presence).not.toBe(missing?.presence);
  });

  test('a populated value is PRESENT', () => {
    const observations = observe(
      'katchup.message.read-time-via-conversation',
      KATCHUP_CONVERSATION,
    );
    expect(observations.find((o) => o.resourceId === '8101')?.presence).toBe('PRESENT');
  });

  test('false and 0 are PRESENT, not treated as missing', () => {
    const observations = observe('kall.participant-state-via-today-kool', KALL_TODAY_KOOL);
    const falseJoin = observations.find((o) => o.stateKey === 'joinStatus' && o.rawValue === false);
    expect(falseJoin?.presence).toBe('PRESENT');

    const zeroStatus = observe(
      'katchup.message.lifecycle-via-conversation',
      KATCHUP_CONVERSATION,
    )[0];
    expect(zeroStatus?.rawValue).toBe(0);
    expect(zeroStatus?.presence).toBe('PRESENT');
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Raw value vs interpretation
// ---------------------------------------------------------------------------------------------

test.describe('state observation: raw vs interpreted @framework', () => {
  test('a numeric code stays numeric — it never becomes a label', () => {
    const observations = observe(
      'katchup.message.lifecycle-via-conversation',
      KATCHUP_CONVERSATION,
    );
    const read = observations.find((o) => o.resourceId === '8101');
    expect(read?.rawValue).toBe(2);
    expect(read?.rawValue).not.toBe('READ');
    expect(read?.rawValue).not.toBe('Read');
  });

  test('interpretation is supplementary and source-backed', () => {
    const observations = observe(
      'katchup.message.lifecycle-via-conversation',
      KATCHUP_CONVERSATION,
    );
    // The Phase 4B model declares rawValue '2' for katchup.message.read, so the match is a citation,
    // not a translation — and the raw value is still right there beside it.
    expect(observations.find((o) => o.resourceId === '8101')?.matchedStateIds).toEqual([
      'katchup.message.read',
    ]);
    expect(observations.find((o) => o.resourceId === '8247')?.matchedStateIds).toEqual([
      'katchup.message.sent',
    ]);
  });

  test('a value the model declares no single mapping for is left uninterpreted', () => {
    // KMail flags are declared as the range 'Y | N', so no state id claims the single value 'Y'.
    const observations = observe('kmail.transaction.state-via-mail-content', KMAIL_MAIL_CONTENT);
    const readStatus = observations.find((o) => o.stateKey === 'readStatus');
    expect(readStatus?.rawValue).toBe('Y');
    expect(readStatus?.matchedStateIds).toEqual([]);
  });

  test('an unmapped code is still observed, with no interpretation invented', () => {
    const observations = observe('katchup.message.lifecycle-via-conversation', {
      data: [{ msgID: 1, status: 99 }],
    });
    expect(observations[0]?.rawValue).toBe(99);
    expect(observations[0]?.matchedStateIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 6. Evidence correlation
// ---------------------------------------------------------------------------------------------

test.describe('state observation: evidence correlation @framework', () => {
  test('every observation references the captured exchange', () => {
    for (const observation of observe(
      'katchup.message.lifecycle-via-conversation',
      KATCHUP_CONVERSATION,
    )) {
      expect(observation.correlationId).toBe('tb-0000-test');
      expect(observation.runId).toBe('run-1');
      expect(observation.testCaseId).toBe('TC-TEST-1');
      expect(observation.observedAt).toBe('2026-09-20T00:00:00.000Z');
    }
  });

  test('the response body is not duplicated into the observation', () => {
    const [observation] = observe(
      'katchup.message.lifecycle-via-conversation',
      KATCHUP_CONVERSATION,
    );
    const serialised = JSON.stringify(observation);
    // Only the one value it reports; no sibling rows, no envelope, no other message's data.
    expect(serialised).not.toContain('8101');
    expect(serialised).not.toContain('lastMsgID');
    expect(serialised).not.toContain('SUCCESS');
    expect(Object.keys(observation ?? {})).not.toContain('body');
    expect(Object.keys(observation ?? {})).not.toContain('response');
  });

  test('the chain observation → definition → endpoint + field path is traceable', () => {
    const [observation] = observe('kmail.transaction.state-via-mail-content', KMAIL_MAIL_CONTENT);
    const definition = requireObservationDefinition(observation?.observationId ?? '');
    expect(definition.endpointId).toBe(observation?.endpointId);
    expect(definition.fieldPath).toBe(observation?.fieldPath);
    expect(definition.provenance.citation.trim()).not.toBe('');
  });
});

// ---------------------------------------------------------------------------------------------
// 7. State registry integration
// ---------------------------------------------------------------------------------------------

test.describe('state observation: registry integration @framework', () => {
  test('every Phase 4B observation definition has a parseable field path', () => {
    for (const definition of STATE_OBSERVATIONS) {
      expect(
        () => parseFieldPath(definition.fieldPath),
        `${definition.observationId} → ${definition.fieldPath}`,
      ).not.toThrow();
    }
  });

  test('every modelled resource declares how it is identified', () => {
    for (const definition of STATE_OBSERVATIONS) {
      const identity = vocabulary(definition.resource)?.identity;
      expect(identity?.field.trim(), definition.resource).not.toBe('');
      expect(identity?.provenance.citation.trim(), definition.resource).not.toBe('');
    }
  });

  test('an unknown observation definition fails deterministically', () => {
    expect(() => observe('not.a.registered.observation', KATCHUP_CONVERSATION)).toThrow(
      StateObservationError,
    );
    expect(() => requireObservationDefinition('katchup.message.invented')).toThrow(
      /not a registered state observation/,
    );
  });

  test('an arbitrary endpoint/field pair cannot be observed', () => {
    // There is no way in: the only entry point takes a registered observation id.
    expect(() => observe('', KATCHUP_CONVERSATION)).toThrow(StateObservationError);
    expect(observationIdsForEndpoint('katchup-conversation')).toContain(
      'katchup.message.lifecycle-via-conversation',
    );
    expect(observationIdsForEndpoint('no-such-endpoint')).toEqual([]);
  });

  test('an unsupported path shape is refused rather than guessed at', () => {
    expect(() => parseFieldPath('data[*].status')).toThrow(FieldPathError);
    expect(() => parseFieldPath('data[0].status')).toThrow(FieldPathError);
    expect(() => parseFieldPath('data[]')).toThrow(FieldPathError);
    expect(() => parseFieldPath('data[].{a,b}.c')).toThrow(FieldPathError);
    expect(() => parseFieldPath('')).toThrow(FieldPathError);
  });
});

// ---------------------------------------------------------------------------------------------
// 8. Actor context
// ---------------------------------------------------------------------------------------------

test.describe('state observation: actor context @framework', () => {
  test('an actor supplied by the caller is preserved', () => {
    const observations = observe(
      'katchup.message.lifecycle-via-conversation',
      KATCHUP_CONVERSATION,
      { actorId: 'sender#0' },
    );
    expect(observations[0]?.actorId).toBe('sender#0');
  });

  test('no actor is invented from the response', () => {
    // Every fixture row carries `sender` and `receiver` fields. Neither is the calling account, and
    // treating one as the caller is how the unresolved read-perspective question gets answered wrong.
    const observations = observe(
      'katchup.message.lifecycle-via-conversation',
      KATCHUP_CONVERSATION,
    );
    for (const observation of observations) {
      expect(observation.actorId).toBeUndefined();
    }
    expect(JSON.stringify(observations)).not.toContain('qa.one@example.invalid');
  });

  test('the read perspective is not resolved anywhere in this layer', () => {
    for (const file of SOURCES) {
      const code = source(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const token of ['perspective', 'senderView', 'recipientView', 'isSender']) {
        expect(code, `${file} mentions ${token}`).not.toContain(token);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 9. Architecture
// ---------------------------------------------------------------------------------------------

test.describe('state observation: architecture @framework', () => {
  test('no expected-state or verdict field exists on an observation', () => {
    const observations = observe(
      'katchup.message.lifecycle-via-conversation',
      KATCHUP_CONVERSATION,
    );
    for (const observation of observations) {
      const keys = Object.keys(observation);
      for (const forbidden of FORBIDDEN_RESULT_KEYS) {
        expect(keys, `observation carries ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  test('the module contains no comparison, classification or filing logic', () => {
    for (const file of SOURCES) {
      // Strip comments AND quoted string literals. The files DISCUSS what they must not do, and
      // `FORBIDDEN_RESULT_KEYS` lists the very words it forbids as DATA — neither is the logic this
      // guard hunts for. Template literals are left intact so nothing real can hide in one.
      const code = source(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/'[^'\n]*'/g, "''")
        .replace(/"[^"\n]*"/g, '""');
      for (const token of [
        'expected',
        'toBe(',
        'assert(',
        'FailureClass',
        'ConfidenceDecision',
        // Precise type names, not the bare word `candidate` — which is this repository's ordinary
        // name for a loop variable. The Bugzilla layer is barred by the import guard below anyway.
        'BugCandidate',
        'ValidationResult',
      ]) {
        expect(code, `${file} contains ${token}`).not.toContain(token);
      }
    }
  });

  test('the module imports nothing from execution, evidence internals or Bugzilla', () => {
    for (const file of SOURCES) {
      const imports = [...source(file).matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '');
      for (const specifier of imports) {
        for (const forbidden of FORBIDDEN_IMPORTS) {
          expect(specifier, `${file} imports ${specifier}`).not.toContain(forbidden);
        }
      }
    }
  });

  test('extraction mutates neither its input nor anything else', () => {
    const before = JSON.stringify(KATCHUP_CONVERSATION);
    observe('katchup.message.lifecycle-via-conversation', KATCHUP_CONVERSATION);
    observe('katchup.message.markers-via-conversation', KATCHUP_CONVERSATION);
    expect(JSON.stringify(KATCHUP_CONVERSATION)).toBe(before);
  });

  test('extraction is deterministic: the same body yields the same observations', () => {
    const first = observe('kall.participant-state-via-today-kool', KALL_TODAY_KOOL);
    const second = observe('kall.participant-state-via-today-kool', KALL_TODAY_KOOL);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test('the public surface observes only — it cannot send, assert or publish', () => {
    const exported = Object.keys(observationModule);
    for (const forbidden of ['send', 'execute', 'assertState', 'verify', 'publish', 'classify']) {
      expect(exported, forbidden).not.toContain(forbidden);
    }
  });
});
