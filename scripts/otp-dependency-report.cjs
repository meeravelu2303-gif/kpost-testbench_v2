#!/usr/bin/env node
/**
 * Which endpoints depend on an OTP — and therefore cannot run against the LIVE application.
 *
 * ## Why this report exists
 *
 * The dev host has an OTP bypass (`123456` always validates). Production does not, and must not.
 * So every flow that consumes an OTP is untestable on live until a real code is delivered to a real
 * device and typed in by a human. That includes registration — which is why no account can be
 * created on live by the bench.
 *
 * Guessing which endpoints those are is how you discover the problem halfway through a run, so the
 * list is DERIVED from the contract rather than maintained by hand:
 *
 *   SENDS     the endpoint sends a real SMS or email containing an OTP
 *   CONSUMES  its documented payload carries an `otp` field
 *   REQUIRES  it needs an OTP validated BEFOREHAND, though no OTP appears in its payload
 *   MENTIONS  OTP appears only in its response or notes (informational)
 *
 * `REQUIRES` cannot be derived — nothing in the workbook records a precondition. Those entries are
 * curated below, and every one cites the observation that established it. That is the category that
 * matters most here: those endpoints look clean in the contract and fail on live anyway.
 *
 * Usage:  node scripts/otp-dependency-report.cjs
 * Writes: contracts/otp-dependent-endpoints.md — the single reference, human-readable.
 *         A framework test parses its tables to confirm every endpoint here carries an
 *         `otpDependent` flag, so the report and the definitions cannot drift apart.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONTRACTS = path.join(ROOT, 'contracts');
const PRODUCTS = ['kpost-api', 'kmail-api'];

const OTP_KEY = /otp/i;
const OTP_WORD = /\botp\b/i;

/**
 * Endpoints that need an OTP validated before they will work, though their payload carries none.
 *
 * Each entry records its evidence AND its confidence, because a precondition nobody can trace
 * becomes folklore and then gets "cleaned up" by whoever cannot see why it is here.
 *
 *   verified  we ran it and watched it fail without the OTP
 *   inferred  a dedicated OTP sender exists for this action and nothing else consumes that OTP
 *
 * An `inferred` entry is a prediction, not a measurement. It is listed because the cost of being
 * wrong is asymmetric: skipping an endpoint that would have worked wastes a test, while running one
 * that needs an OTP burns a real SMS and half-completes a state change on a live account.
 */
const REQUIRES_PRIOR_OTP = [
  {
    path: '/v2/signupLogin/signup/',
    method: 'POST',
    what: 'Personal account registration',
    confidence: 'verified',
    gatedBy: '/v2/common/sendOTP/ + /v2/common/sendOTPtoMail/',
    evidence:
      'Both the mobile and the mail OTP must be sent AND validated first. Every attempt without ' +
      'validateMailOTP fails with "No OTP was found for the given mobileNumber/otherEmail". ' +
      'On live it also returns 400 "Enter valid Credentials" for reasons still unexplained.',
  },
  {
    path: '/v2/signupLogin/adminRegistration/',
    method: 'POST',
    what: 'Business account + company registration (BUSINESS_S/M/L)',
    confidence: 'verified',
    gatedBy: '/v2/common/sendOTP/ + /v2/common/sendOTPtoMail/',
    evidence:
      'Verified 5-step sequence: sendOTP(requestType:"signup") -> sendOTPtoMail -> validateOTP ' +
      '-> validateMailOTP -> adminRegistration. Skipping validateMailOTP fails the final step. ' +
      'This is how the three meera23* accounts were created on dev.',
  },
  {
    path: '/v2/common/forgotPasswordUpdate',
    method: 'POST',
    what: 'Set a new password after password recovery',
    confidence: 'verified',
    gatedBy: '/v2/common/forgotPasswordOTPOrSentKpostIDSms (and an unknown validator)',
    evidence:
      'Answers 400 "OTP validation failed" until an OTP is validated for that account. The ' +
      'documented validateOTP does NOT satisfy it (validated successfully, endpoint still 400) — ' +
      'the flow keeps its own OTP state reached by a call absent from the workbook.',
  },
  /*
   * Found by pairing every OTP sender with the action it exists to gate. The profile module has
   * three senders and no endpoint that consumes their codes, so the OTP must be checked by the
   * action itself — none of which mentions an OTP in its payload.
   */
  {
    path: '/v2/profile/deactivateAccount/',
    method: 'POST',
    what: 'Deactivate the signed-in account',
    confidence: 'inferred',
    gatedBy: '/v2/profile/sendAccountDeactivationOtp/',
    evidence:
      'A dedicated sender exists (sendAccountDeactivationOtp) and no endpoint consumes its code, ' +
      'so deactivateAccount must verify it server-side. Its payload is only {"reason"} — the ' +
      'contract gives no hint. Not run: it would deactivate a live account.',
  },
  {
    path: '/v2/profile/setDeviceAsPrimary/',
    method: 'POST',
    what: 'Register this device as the primary device',
    confidence: 'inferred',
    gatedBy: '/v2/profile/sendPrimaryDeviceOtp/',
    evidence: 'Paired with sendPrimaryDeviceOtp; no other endpoint consumes that code.',
  },
  {
    path: '/v2/profile/updateDeviceAsPrimary/',
    method: 'POST',
    what: 'Move the primary-device designation to this device',
    confidence: 'inferred',
    gatedBy: '/v2/profile/sendPrimaryDeviceOtp/',
    evidence: 'Paired with sendPrimaryDeviceOtp; no other endpoint consumes that code.',
  },
  {
    path: '/v2/profile/setDeviceAsSecondary',
    method: 'POST',
    what: 'Register this device as a secondary device',
    confidence: 'inferred',
    gatedBy: '/v2/profile/sendPrimaryOrSecondaryDeviceOtp/{requestType}',
    evidence: 'Paired with sendPrimaryOrSecondaryDeviceOtp; no other endpoint consumes that code.',
  },
  {
    path: '/v2/profile/updateDeviceAsSecondary',
    method: 'POST',
    what: 'Move a secondary-device designation to this device',
    confidence: 'inferred',
    gatedBy: '/v2/profile/sendPrimaryOrSecondaryDeviceOtp/{requestType}',
    evidence: 'Paired with sendPrimaryOrSecondaryDeviceOtp; no other endpoint consumes that code.',
  },
];

function loadContract(product) {
  const file = path.join(CONTRACTS, `${product}.contract.json`);
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : (parsed.endpoints ?? []);
}

/** Every key in a nested object, so an `otp` nested inside an RO wrapper is still found. */
function keysDeep(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      found.push(key);
      keysDeep(nested, found);
    }
  }
  return found;
}

/** True when the endpoint's own action delivers an OTP to a real phone or mailbox. */
function sendsOtp(record) {
  const target = `${record.path ?? ''} ${record.name ?? ''}`;
  return /send.*otp|otp.*sent|sentKpostIDSms|forgotPasswordOTP/i.test(target);
}

function consumesOtp(record) {
  return keysDeep(record.requestExample).some((key) => OTP_KEY.test(key));
}

function classify(record) {
  const requires = REQUIRES_PRIOR_OTP.find(
    (entry) => entry.path === record.path && entry.method === record.method,
  );
  if (requires) {
    return {
      category: 'REQUIRES',
      note: requires.what,
      evidence: requires.evidence,
      confidence: requires.confidence,
      gatedBy: requires.gatedBy,
    };
  }

  if (sendsOtp(record)) {
    return {
      category: 'SENDS',
      note: 'delivers a real OTP by SMS or email',
      evidence: 'path/name names an OTP send operation',
      confidence: 'verified',
    };
  }
  if (consumesOtp(record)) {
    const keys = keysDeep(record.requestExample).filter((key) => OTP_KEY.test(key));
    return {
      category: 'CONSUMES',
      note: `payload carries ${[...new Set(keys)].join(', ')}`,
      evidence: 'derived from the documented request payload',
      confidence: 'verified',
    };
  }

  const prose = `${record.requestRaw ?? ''} ${record.responseRaw ?? ''} ${(record.reasons ?? []).join(' ')}`;
  if (
    OTP_WORD.test(prose) ||
    OTP_WORD.test(record.path ?? '') ||
    OTP_WORD.test(record.name ?? '')
  ) {
    return {
      category: 'MENTIONS',
      note: 'OTP referenced in the sample response or notes only',
      evidence: 'no OTP field in the payload — informational',
      confidence: 'verified',
    };
  }
  return undefined;
}

/** SENDS costs money and reaches real people; CONSUMES/REQUIRES simply cannot run. */
const LIVE_VERDICT = {
  SENDS: 'BLOCKED — sends a real SMS/email to a real recipient',
  CONSUMES: 'BLOCKED — needs a real OTP we cannot obtain',
  REQUIRES: 'BLOCKED — needs an OTP validated in a prior step',
  MENTIONS: 'allowed — no OTP is sent or consumed',
};

const ORDER = ['REQUIRES', 'CONSUMES', 'SENDS', 'MENTIONS'];

function main() {
  const findings = [];
  for (const product of PRODUCTS) {
    for (const record of loadContract(product)) {
      if (record.usable === false) continue;
      const verdict = classify(record);
      if (!verdict) continue;
      findings.push({
        product,
        tab: record.tab,
        row: record.row,
        module: record.module ?? '',
        method: record.method ?? '',
        path: record.path ?? '',
        ...verdict,
      });
    }
  }

  findings.sort(
    (a, b) =>
      ORDER.indexOf(a.category) - ORDER.indexOf(b.category) ||
      a.product.localeCompare(b.product) ||
      a.path.localeCompare(b.path),
  );

  const missing = REQUIRES_PRIOR_OTP.filter(
    (entry) => !findings.some((f) => f.path === entry.path && f.method === entry.method),
  );

  const counts = {};
  for (const category of ORDER) {
    counts[category] = findings.filter((f) => f.category === category).length;
  }
  const blocked = findings.filter((f) => f.category !== 'MENTIONS');

  // --- Markdown: the single reference, and what a framework test parses ----------------------
  const section = (category, heading, blurb) => {
    const rows = findings.filter((f) => f.category === category);
    if (!rows.length) return null;
    return [
      `### ${heading} — ${rows.length}`,
      '',
      blurb,
      '',
      '| Method | Path | Module | Workbook | Confidence | Why |',
      '| ------ | ---- | ------ | -------- | ---------- | --- |',
      ...rows.map(
        (f) =>
          `| ${f.method} | \`${f.path}\` | ${f.module || '—'} | ${f.tab}!R${f.row} | ` +
          `${f.confidence === 'inferred' ? '**inferred**' : 'verified'} | ${f.note} |`,
      ),
      '',
    ].join('\n');
  };

  const md = [
    '# Endpoints that depend on an OTP',
    '',
    '**GENERATED — do not edit.** `node scripts/otp-dependency-report.cjs`',
    '',
    'The dev host has an OTP bypass (`123456` always validates). **Production does not, and must',
    'not.** So every flow below is untestable against the live application until a real code is',
    'delivered to a real device and entered by a human.',
    '',
    `**${blocked.length} endpoints are blocked on live.** ` +
      (counts.MENTIONS === 1
        ? 'One more mentions an OTP but neither sends nor consumes one, so it runs normally.'
        : `${counts.MENTIONS} more mention an OTP but neither send nor consume one, so they run normally.`),
    '',
    '| Category | Count | What it means on live |',
    '| -------- | ----: | --------------------- |',
    ...ORDER.map((c) => `| \`${c}\` | ${counts[c]} | ${LIVE_VERDICT[c]} |`),
    '',
    '**The consequence that matters: no account can be created on live by this bench.** Both',
    'registration endpoints are in `REQUIRES`, so the QA accounts have to be created by hand or by',
    'the developers, and their credentials supplied to the bench afterwards.',
    '',
    section(
      'REQUIRES',
      'REQUIRES — an OTP validated in an earlier step',
      'Nothing in these endpoints’ payloads mentions an OTP, so the contract cannot reveal ' +
        'this. **They look clean and fail on live anyway** — which is exactly why this list is ' +
        'curated by hand from observed behaviour rather than derived.',
    ),
    section(
      'CONSUMES',
      'CONSUMES — the payload carries an OTP field',
      'Derived from the documented request payload. Without a real code these can only ever be ' +
        'exercised with an invalid OTP, which tests the rejection path and nothing else.',
    ),
    section(
      'SENDS',
      'SENDS — delivers a real SMS or email',
      'These would *work* on live, which is the problem: each call costs money and reaches a real ' +
        'phone or mailbox. Note that the negative probes mutate the recipient field, so a run ' +
        'would message numbers that are not ours. Already fenced as `sideEffect: external`.',
    ),
    section(
      'MENTIONS',
      'MENTIONS — informational only',
      'OTP appears in the sample response or the notes, but the endpoint neither sends nor ' +
        'consumes one. Listed so nobody skips them by a careless text search for "otp".',
    ),
    ...(missing.length
      ? [
          '## Curated entries not found in the contract',
          '',
          'A `REQUIRES_PRIOR_OTP` entry no longer matches any usable contract row — the path or',
          'method changed in a workbook dump, and the precondition is now unrecorded:',
          '',
          ...missing.map((entry) => `- \`${entry.method} ${entry.path}\` — ${entry.what}`),
          '',
        ]
      : []),
    '## The evidence behind each `REQUIRES` entry',
    '',
    ...REQUIRES_PRIOR_OTP.flatMap((entry) => [
      `**\`${entry.method} ${entry.path}\`** — ${entry.what}  ` +
        `(${entry.confidence === 'inferred' ? '**inferred**' : 'verified'})`,
      '',
      `Gated by: \`${entry.gatedBy}\``,
      '',
      `> ${entry.evidence}`,
      '',
    ]),
  ]
    .filter((line) => line !== null)
    .join('\n');

  fs.writeFileSync(path.join(CONTRACTS, 'otp-dependent-endpoints.md'), `${md}\n`);

  console.log('OTP dependency report');
  for (const category of ORDER) {
    console.log(`  ${category.padEnd(9)} ${String(counts[category]).padStart(3)}`);
  }
  console.log(`  ${'BLOCKED'.padEnd(9)} ${String(blocked.length).padStart(3)} (on live)`);
  if (missing.length) {
    console.log('\n  WARNING: curated entries no longer in the contract:');
    for (const entry of missing) console.log(`    ${entry.method} ${entry.path}`);
  }
  console.log('\n  contracts/otp-dependent-endpoints.md');
}

main();
