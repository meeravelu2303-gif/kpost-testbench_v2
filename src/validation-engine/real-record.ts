import type { RequestSpec } from '@api/client/request-builder';
import { apiRegistry } from '@api/definitions/index';
import { expect, test } from '@fixtures';
import { formatReport } from '@reporting/report-formatter';
import { isLenientAcceptanceFalsePositive } from '../bug-tracker/findings/bug-candidate';
import { KNOWN_FALSE_POSITIVES } from '../bug-tracker/gates/known-false-positives';
import { ProductionSafetyError } from './production-guard';
import type { ValidationEngine } from './validation-engine';

/**
 * The full engine (negative, boundary, authentication, authorization, security, performance and
 * contract checks) on an endpoint the generic sweep may not send because it needs a real record: a
 * message id, an attachment uuid, a group or trip id. A flow that has just created that record calls
 * this with the exact request it sends, so the engine probes a real record instead of a placeholder
 * that could name somebody else's.
 *
 * Only this one call is cloned `productionSafe`; every other guard stays armed: the SMS kill-switch
 * and `global` walls still refuse, and the QA-identifier guard still checks every id, so the flow
 * names the ids it minted (`ownedIdentifiers`). The report is attached to the flow's test like any
 * engine run, so its findings are filed through the same pipeline. The pattern is the Admin API's
 * endpoint matrix (tests/admin-api/e2e/admin-endpoint-matrix-e2e.spec.ts).
 *
 * The test-type ledger credits an endpoint only when its id is the literal second argument of a
 * `checkOnRealRecord(` call, or is listed in a `realRecordIds([...])` that a loop of such calls runs on.
 */
export const realRecordIds = <const T extends readonly unknown[]>(list: T): T => list;

export async function checkOnRealRecord(
  engine: ValidationEngine,
  endpointId: string,
  spec: RequestSpec,
  ownedIdentifiers: readonly (string | number)[] = [],
): Promise<void> {
  const base = apiRegistry.get(endpointId);
  const definition = { ...base, productionSafe: true, request: () => spec };
  let report;
  try {
    report = await engine.validate(definition, { ownedIdentifiers });
  } catch (error) {
    // The guard refused the engine (a shared-state write, an SMS sender): a fact to record, never
    // a reason to fail the flow that called this. Any other error is real and propagates.
    if (!(error instanceof ProductionSafetyError)) throw error;
    test.info().annotations.push({
      type: 'real-record-refused',
      description: `${endpointId}: ${error.message.slice(0, 300)}`,
    });
    return;
  }
  // A check judged not a defect (known-false-positives.ts, by endpoint + check) does not fail here,
  // nor does lenient acceptance of bad input with no crash: the filer drops those too
  // (isLenientAcceptanceFalsePositive), so the flow fails only on what would be filed.
  const judged = (validator: string): boolean =>
    KNOWN_FALSE_POSITIVES.some(
      (k) =>
        !k.fingerprint &&
        k.validator === validator &&
        k.endpoint !== undefined &&
        definition.path.includes(k.endpoint),
    );
  const lenient = new Set(
    report.results.filter(isLenientAcceptanceFalsePositive).map((r) => r.validatorName),
  );
  expect
    .soft(
      report.gate.blocking.filter((validator) => !judged(validator) && !lenient.has(validator)),
      `${endpointId} on a real record\n${formatReport(report)}`,
    )
    .toEqual([]);
}
