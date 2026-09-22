/* Prints the captured token to stdout ONLY if it is genuinely past its exp; otherwise prints nothing.
 * Used as: cross-env EXPIRED_TOKEN=$(node scripts/aged-token.cjs) npm run kpost */
const fs = require('fs');
const path = require('path');
const F = path.join(__dirname, '..', '.auth', 'aging-token.json');
try {
  const { token, exp } = JSON.parse(fs.readFileSync(F, 'utf8'));
  if (exp && Math.floor(Date.now() / 1000) > exp) process.stdout.write(token);
  else process.stderr.write(`aging token not expired yet (or missing); EXPIRED_TOKEN stays empty\n`);
} catch {
  process.stderr.write('no .auth/aging-token.json — run: node scripts/capture-token.cjs\n');
}
