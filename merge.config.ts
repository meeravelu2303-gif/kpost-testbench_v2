import { defineConfig } from '@playwright/test';

/** Used by CI to merge sharded blob reports into HTML, JUnit and the validation summary. */
export default defineConfig({
  testDir: './tests',
  reporter: [
    ['html', { open: 'never' }],
    ['junit', { outputFile: 'junit-report/results.xml' }],
    ['./src/reporting/validation-reporter.ts'],
  ],
});
