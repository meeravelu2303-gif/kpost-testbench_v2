/*
 * Cross-platform runner for the expired-token KPost pass.
 *
 * Replaces the bash-only `EXPIRED_TOKEN=$(node scripts/aged-token.cjs) … playwright test …`, which
 * fails on Windows because cmd.exe / PowerShell do not evaluate `$(…)` — cross-env then tries to run
 * `scripts\aged-token.cjs)` as a program (ENOENT). This resolves the aged token in-process, sets the
 * env, and launches Playwright, so it works the same on Windows, macOS and Linux.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Resolve a genuinely-expired token from the captured aging token, if there is one.
let expiredToken = '';
const tokenFile = path.join(__dirname, '..', '.auth', 'aging-token.json');
try {
  const { token, exp } = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
  if (exp && Math.floor(Date.now() / 1000) > exp) {
    expiredToken = token;
    console.log('[kpost:expired] using captured token that is now past its exp.');
  } else {
    console.warn(
      '[kpost:expired] the captured token has NOT expired yet — EXPIRED_TOKEN left empty. The ' +
        'run still proceeds; the bench falls back to its own token history, and the expired-token ' +
        'check skips if none is available. Capture a fresh one with: npm run token:capture',
    );
  }
} catch {
  console.warn(
    '[kpost:expired] no .auth/aging-token.json found. Run `npm run token:capture` once, wait for ' +
      'it to age past its 24h exp, then re-run. Proceeding without an explicit EXPIRED_TOKEN.',
  );
}

const env = {
  ...process.env,
  BUGZILLA_DRY_RUN: 'true',
  TEST_DB_MODE: 'true',
  MOCK_API: 'false',
};
if (expiredToken) env.EXPIRED_TOKEN = expiredToken;

const result = spawnSync(
  'npx',
  ['playwright', 'test', '--project=api', 'tests/api/kpost', '--workers=1'],
  { stdio: 'inherit', env, shell: true },
);
process.exit(result.status ?? 1);
