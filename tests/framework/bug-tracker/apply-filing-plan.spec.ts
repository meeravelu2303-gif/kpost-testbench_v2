import { readBugzillaConfig } from '../../../src/config/bugzilla.config';
import {
  FILING_INPUT_FILE,
  loadFilingPlan,
  markFilingPlanApplied,
  runFiling,
  writeRunReport,
} from '../../../src/bug-tracker/filing/filing-run';
import { createLogger } from '../../../src/utils/logger';
import { expect, test } from '@fixtures';

/**
 * `npm run bug:apply`: files the last preview run's findings to Bugzilla without running the tests
 * again. It replays that run's saved filing input through the same filing step a `:file` run uses
 * (validity gate, live duplicate search, reopen/comment/close rules), so the result is the same as if
 * the preview had been a `:file` run. Refuses a plan that is not an unapplied, valid preview under a day old.
 */
test('apply the last preview run to Bugzilla', async () => {
  test.skip(
    process.env.APPLY_FILING_PLAN !== 'true',
    'opt-in: this writes to Bugzilla — run `npm run bug:apply` after a product preview',
  );
  test.setTimeout(60 * 60_000);

  const config = readBugzillaConfig();
  expect(config.enabled, 'BUGZILLA_URL and BUGZILLA_API_KEY must be set in .env').toBe(true);
  expect(config.dryRun, 'bug:apply must run with BUGZILLA_DRY_RUN=false').toBe(false);

  const plan = loadFilingPlan();
  expect('refused' in plan ? plan.refused : '', `${FILING_INPUT_FILE} cannot be applied`).toBe('');
  if ('refused' in plan) return;
  const { input } = plan;
  console.log(
    `Applying the ${input.product} preview of ${input.checkedAt} (run ${input.testRunId}): ` +
      `${input.candidates.length} finding(s) before the validity gate.`,
  );

  const log = createLogger('bugzilla');
  const result = await runFiling(input, config, log);
  // Marked applied whatever happened, so a second apply can never comment or file twice.
  markFilingPlanApplied(input);
  writeRunReport(input, result, log, { write: true });
});
