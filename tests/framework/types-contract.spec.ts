import {
  KALL_STATUS,
  KMAIL_RECEIVER_TYPE,
  KMAIL_TYPE,
  KPOST_MODULE,
  KPOST_TYPES,
  TYPE_GROUPS,
  USER_TYPES,
  codeFor,
  codesOf,
  labelFor,
  numericCodesOf,
} from '@api/schemas/kpost-types';
import { expect, test } from '@fixtures';

/**
 * The type codes are part of the API contract — a payload that sends `kmailType: 11` means
 * "share". These pin the groups and a few load-bearing values, so a workbook edit that renames or
 * renumbers something fails here instead of silently changing what the bench sends.
 */

/** Every group the workbook is expected to define. A missing one is a contract change. */
const REQUIRED_GROUPS = [
  'katchupStatus',
  'katchupMessageType',
  'katchupShareType',
  'kallStatus',
  'kallType',
  'kallMode',
  'kallRepeatType',
  'kmailType',
  'kmailReceiverType',
  'kmailPriority',
  'kdiaryRemarks',
  'module',
  'userType',
] as const;

test.describe('KPost types contract', { tag: '@framework' }, () => {
  test('every expected type group is present and populated', () => {
    for (const group of REQUIRED_GROUPS) {
      expect(TYPE_GROUPS, `group "${group}" is missing from the workbook`).toContain(group);
      expect(codesOf(group).length, `group "${group}" is empty`).toBeGreaterThan(0);
    }
    expect(TYPE_GROUPS).toHaveLength(REQUIRED_GROUPS.length);
  });

  test('the values payloads depend on still mean what they did', () => {
    // KMail: these are the codes sent on every mail operation.
    expect(KMAIL_TYPE.new).toBe(0);
    expect(KMAIL_TYPE.reply).toBe(1);
    expect(KMAIL_TYPE.forward).toBe(2);
    expect(KMAIL_TYPE.share).toBe(11);
    expect(KMAIL_TYPE.bulkmail).toBe(13);

    // Receiver types decide who sees a mail — TO vs COPY vs CONFIDENTIAL.
    expect(KMAIL_RECEIVER_TYPE.receiverTypeTo).toBe(1);
    expect(KMAIL_RECEIVER_TYPE.receiverTypeCopy).toBe(2);
    expect(KMAIL_RECEIVER_TYPE.receiverTypeConfidential).toBe(3);

    // Kall status drives call state transitions.
    expect(KALL_STATUS.new).toBe(0);
    expect(KALL_STATUS.cancelled).toBe(2);
    expect(KALL_STATUS.scheduled).toBe(6);

    // Module ids are sent by several KPost routes.
    expect(KPOST_MODULE.kpost).toBe(0);
    expect(KPOST_MODULE.adminmodule).toBe(4);
  });

  test('codes and labels resolve in both directions', () => {
    expect(labelFor('kmailType', 11)).toBe('share');
    expect(labelFor('kdiaryRemarks', 1)).toBe('Completed');
    expect(codeFor('kmailType', 'Share')).toBe(11);
    expect(codeFor('kallStatus', 're scheduled')).toBe(7);
    expect(codeFor('kmailType', 'not a real label')).toBeUndefined();
  });

  test('numeric groups expose numbers, and userType is the documented exception', () => {
    for (const group of REQUIRED_GROUPS.filter((g) => g !== 'userType')) {
      expect(numericCodesOf(group).length, `group "${group}" has no numeric codes`).toBeGreaterThan(
        0,
      );
    }
    // The workbook documents the business tiers as labels only — no numbers to expose.
    expect(numericCodesOf('userType')).toHaveLength(0);
    expect(USER_TYPES).toEqual(expect.arrayContaining(['BUSINESS_S', 'BUSINESS_M', 'BUSINESS_L']));
  });

  test('no group contains an empty or duplicated label', () => {
    for (const group of TYPE_GROUPS) {
      const labels = Object.values(KPOST_TYPES[group]);
      expect(
        labels.filter((l) => !l.trim()),
        `group "${group}" has a blank label`,
      ).toHaveLength(0);
      expect(new Set(labels).size, `group "${group}" repeats a label`).toBe(labels.length);
    }
  });
});
