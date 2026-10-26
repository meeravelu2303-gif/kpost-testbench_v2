import typesContract from '../../../contracts/kpost-types.json';

/**
 * The KPost type codes, straight from the workbook's Types tab.
 *
 * These numbers are part of the API contract: a payload sends `kmailType: 11` and means "share",
 * `receiverType: 1` and means "TO". Hard-coding them in test data is how they drift — so the
 * generated contract is the only copy, and this module is the typed way to read it.
 *
 * Regenerate with `npm run contract:excel`; tests/framework/types-contract.spec.ts fails if a
 * group disappears or a pinned value changes, so a workbook edit cannot silently alter meaning.
 */

const SECTIONS = typesContract.sections;

export type TypeGroup = keyof typeof SECTIONS;

/** code → label, e.g. KPOST_TYPES.kmailType['11'] === 'share'. */
export const KPOST_TYPES: Readonly<Record<TypeGroup, Readonly<Record<string, string>>>> = SECTIONS;

export const TYPE_GROUPS = Object.keys(SECTIONS) as TypeGroup[];

/** Every code in a group, in the order the workbook lists them. */
export function codesOf(group: TypeGroup): string[] {
  return Object.keys(KPOST_TYPES[group]);
}

/** Numeric codes only — most groups are numeric; `userType` is not. */
export function numericCodesOf(group: TypeGroup): number[] {
  return codesOf(group)
    .filter((code) => /^\d+$/.test(code))
    .map(Number);
}

export function labelFor(group: TypeGroup, code: string | number): string | undefined {
  return KPOST_TYPES[group][String(code)];
}

/** Reverse lookup, case- and spacing-insensitive: codeFor('kmailType', 'Share') === 11. */
export function codeFor(group: TypeGroup, label: string): number | string | undefined {
  const wanted = label.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [code, value] of Object.entries(KPOST_TYPES[group])) {
    if (value.toLowerCase().replace(/[^a-z0-9]/g, '') === wanted) {
      return /^\d+$/.test(code) ? Number(code) : code;
    }
  }
  return undefined;
}

const camelKey = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)?/g, (_, chr: string | undefined) => (chr ? chr.toUpperCase() : ''))
    .replace(/^(\d)/, '_$1');

/** label → code, keyed for code use: KMAIL_TYPE.share === 11. */
function byLabel(group: TypeGroup): Readonly<Record<string, number>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(KPOST_TYPES[group])
        .filter(([code]) => /^\d+$/.test(code))
        .map(([code, label]) => [camelKey(label), Number(code)]),
    ),
  );
}

/* The groups payloads actually reference, named so a builder reads like the API docs. */
export const KATCHUP_STATUS = byLabel('katchupStatus');
export const KATCHUP_MESSAGE_TYPE = byLabel('katchupMessageType');
export const KATCHUP_SHARE_TYPE = byLabel('katchupShareType');
export const KALL_STATUS = byLabel('kallStatus');
export const KALL_TYPE = byLabel('kallType');
export const KALL_MODE = byLabel('kallMode');
export const KALL_REPEAT_TYPE = byLabel('kallRepeatType');
export const KMAIL_TYPE = byLabel('kmailType');
export const KMAIL_RECEIVER_TYPE = byLabel('kmailReceiverType');
export const KMAIL_PRIORITY = byLabel('kmailPriority');
export const KDIARY_REMARKS = byLabel('kdiaryRemarks');
export const KPOST_MODULE = byLabel('module');

/** Business tiers. The workbook gives labels only for this group — no numeric codes. */
export const USER_TYPES = codesOf('userType');

/** Which workbook this was generated from, for reports and drift messages. */
export const TYPES_SOURCE = typesContract.source;
