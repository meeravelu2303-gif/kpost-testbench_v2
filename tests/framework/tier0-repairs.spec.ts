import { ROOT_DIR } from '@config/constants';
import { expect, test } from '@fixtures';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { contactRows, findContact, hasContact } from '../api/support/contacts-response';

/**
 * Guards for the Phase 4G Tier 0 repairs.
 *
 * Each of the three defects these cover shared one property: the test reported green for behaviour
 * it never established. These guards exist so that property cannot come back silently — they run
 * offline, on every framework pass, with no live host and no gate.
 *
 *   1. Contacts — a tautological assertion (`expect(true).toBe(true)`) labelled as a state check.
 *   2. Group   — a file claiming to be "self-cleaning" whose last statement was the create.
 *   3. Katchup — a delete sending a field the endpoint definition calls "the wrong shape".
 */

const source = (...segments: string[]): string =>
  readFileSync(path.join(ROOT_DIR, ...segments), 'utf8');

/**
 * The file with comments removed.
 *
 * Every repaired file DOCUMENTS the defect it fixed, quoting the old code verbatim so the next
 * reader understands why the current shape matters. A guard that searched the raw text would match
 * that explanation and demand the documentation be deleted — punishing the very thing that makes
 * the fix legible. These guards look at code.
 */
const code = (...segments: string[]): string =>
  source(...segments)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const CONTACTS_SPEC = ['tests', 'api', 'kpost', 'contacts', 'feature.spec.ts'] as const;
const GROUP_SPEC = ['tests', 'e2e', 'group.spec.ts'] as const;
const KATCHUP_LIFECYCLE = ['tests', 'api', 'kpost', 'katchup', 'lifecycle.spec.ts'] as const;

/** A `myContacts` body in the documented shape. */
const addressBook = {
  lastFetchDate: '2026-09-20T00:00:00.000+00:00',
  contacts_added: [
    {
      id: 1,
      kpostID: 'qa.one@kpostindia.com',
      contactID: 'qa.two@kpostindia.com',
      isBlocked: false,
    },
    {
      id: 2,
      kpostID: 'qa.one@kpostindia.com',
      contactID: 'QA.Three@kpostindia.com',
      isBlocked: true,
    },
  ],
  status: 'SUCCESS',
};

// ---------------------------------------------------------------------------------------------
// 1. Contacts — the matcher must discriminate (the negative proof)
// ---------------------------------------------------------------------------------------------

test.describe('tier0: contacts address-book matcher @framework', () => {
  test('finds a contact that is present', () => {
    expect(hasContact(addressBook, 'qa.two@kpostindia.com')).toBe(true);
    expect(findContact(addressBook, 'qa.two@kpostindia.com')?.id).toBe(1);
  });

  test('does NOT find a contact that is absent — the assertion can fail', () => {
    /*
     * The whole point. The assertion this replaced was `expect.soft(true, '…').toBe(true)`, which
     * returns the same answer for every input. A matcher that cannot say "no" is worth nothing.
     */
    expect(hasContact(addressBook, 'qa.bench.absent.negative-control@kpostindia.com')).toBe(false);
    expect(findContact(addressBook, 'nobody@kpostindia.com')).toBeUndefined();
  });

  test('matches case-insensitively, as the application echoes its own casing', () => {
    expect(hasContact(addressBook, 'qa.three@kpostindia.com')).toBe(true);
    expect(hasContact(addressBook, '  QA.TWO@KPOSTINDIA.COM ')).toBe(true);
  });

  test('a body that is not the documented shape yields no contacts, never a false positive', () => {
    for (const body of [undefined, null, {}, [], 'text', { contacts_added: 'nope' }]) {
      expect(contactRows(body), JSON.stringify(body)).toEqual([]);
      expect(hasContact(body, 'qa.two@kpostindia.com'), JSON.stringify(body)).toBe(false);
    }
    // An error envelope is not an address book.
    expect(hasContact({ status: 'FAILURE', statusCode: 500 }, 'qa.two@kpostindia.com')).toBe(false);
  });

  test('an empty id never matches', () => {
    expect(hasContact(addressBook, '')).toBe(false);
    expect(hasContact(addressBook, '   ')).toBe(false);
  });

  test('the contacts spec no longer asserts a tautology', () => {
    // Comments stripped: the spec quotes the old tautology verbatim to explain the repair.
    const body = code(...CONTACTS_SPEC);
    expect(body.replace(/\s+/g, ''), 'a literal true==true assertion').not.toContain(
      'expect.soft(true,',
    );
    expect(body).toContain('hasContact');
    expect(source(...CONTACTS_SPEC)).toContain('appears in myContacts');
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Katchup — the delete must use the contract shape and observe the outcome
// ---------------------------------------------------------------------------------------------

test.describe('tier0: katchup delete contract @framework', () => {
  test('the endpoint definition declares messageIds, an array', () => {
    const definition = source('src', 'api', 'definitions', 'kpost', 'katchup', 'manage.api.ts');
    expect(definition).toContain('messageIds: [0]');
  });

  test('no test sends a bare msgID to the delete endpoint', () => {
    /*
     * The defect: the lifecycle sent `{ msgID }` while the definition declared `messageIds`, under
     * the title "delete removes it entirely". The definition's own comment calls that "the wrong
     * shape [that] can leave the message undeleted (orphan)" — and it did, 18 times.
     */
    for (const spec of [
      KATCHUP_LIFECYCLE,
      ['tests', 'api', 'kpost', 'katchup', 'feature.spec.ts'],
    ]) {
      const text = code(...spec);
      const deleteCalls = [...text.matchAll(/katchup-delete-message[\s\S]{0,200}?\}/g)].map(
        (m) => m[0],
      );
      expect(deleteCalls.length, `${spec.join('/')} calls the delete endpoint`).toBeGreaterThan(0);
      for (const call of deleteCalls) {
        expect(call, `${spec.join('/')} delete payload`).toContain('messageIds');
        expect(call, `${spec.join('/')} sends a bare msgID`).not.toMatch(/body:\s*\{\s*msgID\b/);
      }
    }
  });

  test('the delete test observes absence, not just a status code', () => {
    const spec = source(...KATCHUP_LIFECYCLE);
    expect(spec).toContain('messageInConversation');
    expect(spec).toContain('the message exists before delete');
    expect(spec).toContain('no longer appears in the conversation');
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Group — nothing it creates may go unaccounted for
// ---------------------------------------------------------------------------------------------

test.describe('tier0: group UI cleanup @framework', () => {
  test('the group spec registers what it creates with the resource ledger', () => {
    const spec = source(...GROUP_SPEC);
    expect(spec).toContain('resources.track(');
    expect(spec).toContain("kind: 'katchup-group'");
    expect(spec).toContain('cleanup: () => deleteGroup(');
  });

  test('cleanup removes members before deleting, as the application requires', () => {
    const spec = source(...GROUP_SPEC);
    expect(spec).toContain('group-remove-member');
    expect(spec).toContain('group-delete');
    // Members first: deleteGroup alone answers 400 "you need to remove all the members".
    expect(spec.indexOf('group-remove-member')).toBeLessThan(spec.indexOf('group-delete'));
  });

  test('the false self-cleaning claim is gone', () => {
    const spec = code(...GROUP_SPEC);
    // The header used to promise "self-cleaning (delete the group it creates)" while deleting nothing.
    expect(spec).not.toContain('self-cleaning (delete the group it creates');
    expect(spec).not.toContain('then delete the group to clean up');
  });

  test('the created group is identified before the test can end', () => {
    const spec = source(...GROUP_SPEC);
    expect(spec).toContain('findGroupByName');
    expect(spec).toContain('identified and registered for cleanup');
  });
});
