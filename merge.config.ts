import { defineConfig } from '@playwright/test';

/** Used by CI to merge sharded blob reports into HTML, JUnit and the validation summary. */
export default defineConfig({
  testDir: './tests',
  reporter: [
    ['html', { open: 'never' }],
    ['junit', { outputFile: 'junit-report/results.xml' }],
    // Writes the single neat report — reports/REPORT.{md,json} (execution health + bugs) — and files
    // bugs once, from the complete merged run, never from an individual shard.
    // Evidence is persisted by its own reporter, independently of defect filing (Phase 3.2).
    ['./src/reporting/evidence-reporter.ts'],
    ['./src/reporting/bugzilla-reporter.ts'],
  ],
});
