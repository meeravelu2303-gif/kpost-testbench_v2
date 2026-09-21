import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ActorContext, ActorContextError, actorIdFor } from '../../src/actors/index';
import { describeViews, rowsOf, viewContains, type ActorView } from '../api/support/cross-actor';

/**
 * Guards for cross-actor coverage (master plan §10, §15).
 *
 * The rule they exist to protect is that **the same resource legitimately looks different to
 * different actors**, and a bench that collapses those into one "the message exists" assertion
 * cannot test a visibility rule at all. A confidential copy is the clearest case: the sender sees
 * the hidden list, the confidential recipient sees themselves in it, and the TO recipient must see
 * an empty one — three different true observations of one message.
 *
 * Pure: nothing here logs in, sends a request or touches an account.
 */

const view = (over: Partial<ActorView> = {}): ActorView => ({
  role: 'recipient',
  account: 'victim',
  endpointId: 'katchup-conversation',
  status: 200,
  body: { data: [{ msgID: 1, sharedMessageId: 99 }] },
  text: '{"data":[{"msgID":1}]}',
  observations: [],
  correlationId: 'tb-1',
  ...over,
});

test.describe('cross-actor: role resolution and identity @framework', () => {
  test('the same role resolves to the same participant, every time, within one run', () => {
    // "the sender recalls the message they sent" is a statement about ONE participant. If two
    // resolutions of `sender` gave different actors it would silently become a statement about two.
    const context = new ActorContext(['sender', 'recipient']);
    expect(context.actor('sender')).toBe(context.actor('sender'));
    expect(context.actor('sender').actorId).toBe('sender#0');
  });

  test('different roles resolve to different participants', () => {
    const context = new ActorContext(['sender', 'recipient', 'confidential-copy-recipient']);
    const ids = ['sender', 'recipient', 'confidential-copy-recipient'].map(
      (role) => context.actor(role as 'sender').actorId,
    );
    expect(new Set(ids).size, 'three roles, three participants').toBe(3);
    expect(ids).toEqual(['sender#0', 'recipient#0', 'confidential-copy-recipient#0']);
  });

  test('several participants of ONE role are distinct — a group has many members', () => {
    const context = new ActorContext(['group-member']);
    expect(context.actor('group-member', 0).actorId).toBe('group-member#0');
    expect(context.actor('group-member', 2).actorId).toBe('group-member#2');
    expect(context.actor('group-member', 0)).not.toBe(context.actor('group-member', 2));
    expect(actorIdFor('group-member', 2)).toBe('group-member#2');
  });

  test('a role the flow never declared cannot be resolved', () => {
    // A flow that resolves an undeclared role is describing a participant it never said it needed.
    const context = new ActorContext(['sender']);
    expect(() => context.actor('confidential-copy-recipient')).toThrow(ActorContextError);
  });

  test('two runs share no participant and no binding', () => {
    const first = new ActorContext(['sender']);
    const second = new ActorContext(['sender']);
    expect(first.actor('sender')).not.toBe(second.actor('sender'));
    expect(first.isBound('sender')).toBe(false);
    expect(second.isBound('sender')).toBe(false);
  });
});

test.describe('cross-actor: an observation keeps its perspective @framework', () => {
  test('a view names the role and the account that made it', () => {
    const observed = view({ role: 'confidential-copy-recipient', account: 'personal-3' });
    expect(observed.role).toBe('confidential-copy-recipient');
    expect(observed.account).toBe('personal-3');
    expect(observed.correlationId, 'the evidence stays reachable').toBe('tb-1');
  });

  test('the account is identified by its POOL KEY, never by a credential', () => {
    /*
     * A cross-actor report says which actor saw what. It must be able to do that without ever
     * naming a real login — the account pool already keeps `principal` non-enumerable for the same
     * reason, and a report that leaked one would undo it.
     */
    const rendered = describeViews([
      view({ role: 'sender', account: 'personal' }),
      view({ role: 'recipient', account: 'victim' }),
    ]).join('\n');
    expect(rendered).toContain('personal');
    expect(rendered).not.toMatch(/@|password|token|authorization|api[_-]?key/i);
  });

  test('the same resource may be observed differently by different actors', () => {
    // The property the whole layer exists for. Collapsing these into one assertion would make a
    // visibility rule untestable.
    const senderView = view({
      role: 'sender',
      body: { data: [{ msgID: 1, hidden: ['c@example.invalid'] }] },
    });
    const recipientView = view({ role: 'recipient', body: { data: [{ msgID: 1, hidden: [] }] } });

    expect(viewContains(senderView, 'msgID', 1), 'both hold the same resource').toBe(true);
    expect(viewContains(recipientView, 'msgID', 1)).toBe(true);
    expect(
      rowsOf(senderView.body)[0]?.hidden,
      'and legitimately disagree about what is in it',
    ).not.toEqual(rowsOf(recipientView.body)[0]?.hidden);
  });

  test('a row list is read from the documented key, not guessed', () => {
    // `myGroups` answers under `group_added`, not `data`. Guessing the key would silently report an
    // empty view and turn a real membership into a false absence.
    const groups = view({ body: { group_added: [{ groupID: 7 }] } });
    expect(rowsOf(groups.body), 'the default key finds nothing here').toEqual([]);
    expect(viewContains(groups, 'groupID', 7, 'group_added')).toBe(true);
  });
});

test.describe('cross-actor: the specs correlate on identity, not on text @framework', () => {
  test('no cross-actor spec proves delivery by matching a subject alone', () => {
    /*
     * Several accounts holding "the same subject" proves nothing about which message each of them
     * has. The copies flow measured this on live: every recipient gets their OWN `msgID`, and only
     * `sharedMessageId` links them. A spec that asserted on the subject would pass while comparing
     * different rows.
     */
    const specs = readdirSync(path.join(ROOT_DIR, 'tests', 'api'), { recursive: true })
      .map(String)
      .filter((name) => name.endsWith('cross-actor.spec.ts'))
      .map((name) => path.join(ROOT_DIR, 'tests', 'api', name));
    expect(specs.length, 'the cross-actor specs were found').toBeGreaterThan(1);

    for (const spec of specs) {
      const source = readFileSync(spec, 'utf8');
      expect(
        /sharedMessageId|groupID|kallID|msgID/.test(source),
        `${path.basename(path.dirname(spec))} must correlate on a documented identity`,
      ).toBe(true);
    }
  });

  test('every cross-actor spec registers what it creates before asserting', () => {
    // A resource registered after an assertion is a resource a failure can orphan.
    const specs = readdirSync(path.join(ROOT_DIR, 'tests', 'api'), { recursive: true })
      .map(String)
      .filter((name) => name.endsWith('cross-actor.spec.ts'))
      .map((name) => path.join(ROOT_DIR, 'tests', 'api', name));

    const missing = specs
      .filter((spec) => !readFileSync(spec, 'utf8').includes('resources.track('))
      .map((spec) => path.basename(path.dirname(spec)));
    expect(missing, 'a cross-actor flow creates a resource and must register it').toEqual([]);
  });
});

test.describe('cross-channel: the browser is never driven as an API-authenticated account @framework', () => {
  /*
   * A bench defect this guard exists to stop coming back.
   *
   * KPOST allows ONE active session per account, so an API login DISPLACES that account's saved
   * browser session. A page driven afterwards as the same account renders its conversation list as an
   * empty skeleton forever — its own reads are now unauthorised. On live that cost two full debugging
   * rounds and looked precisely like a product defect: no error, no redirect to /login, just a list
   * that never fills.
   *
   * So `cross-channel.spec.ts` keeps the identities apart: account A is the API's identity in both
   * directions, and account B's saved state is the only browser identity. Nothing logs in as B
   * through the API, so nothing can displace the session the browser is using.
   */
  const source = readFileSync(path.join(ROOT_DIR, 'tests', 'e2e', 'cross-channel.spec.ts'), 'utf8');

  test('every API call in the cross-channel spec authenticates as A, never as the browser account', () => {
    const principals = [...source.matchAll(/principal:\s*([A-Z])\b/g)].map((match) => match[1]);
    expect(principals.length, 'the spec does authenticate through the API').toBeGreaterThan(0);
    expect(
      [...new Set(principals)],
      'B is the browser identity; an API login as B would displace the session the UI is using',
    ).toEqual(['A']);
  });

  test('the only browser session it opens is account B, from the saved state', () => {
    expect(source).toContain('STORAGE_STATE_2');
    expect(
      /storageState:\s*STORAGE_STATE(?!_2)/.test(source),
      "account A's browser state must not be opened — the API holds that account's session",
    ).toBe(false);
  });

  test('it never takes the default `page` fixture, which is signed in as A', () => {
    // The default fixture carries `.auth/user.json` — account A. Taking it is the exact mistake.
    const takesDefaultPage = /async \({\s*page\s*,/.test(source);
    expect(
      takesDefaultPage,
      "a cross-channel test must open B's context explicitly rather than take the default page",
    ).toBe(false);
  });
});
