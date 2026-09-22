/* eslint-disable no-undef -- fetch is a Node 18+ global; this cjs block does not include it */
/*
 * Capture a real access token so it can be used as EXPIRED_TOKEN later.
 *
 * The authentication.expired-token validator needs a token this server actually signed — it verifies
 * signatures, so a forged or hand-edited token is rejected as invalid rather than as expired, which
 * would test the wrong thing. Tokens live 24h, so the only honest way to get an expired one is to
 * capture a valid one and let it age out.
 *
 *   node scripts/capture-token.cjs      # logs in, saves .auth/aging-token.json with the exp
 *
 * Then, on any run at least 24h later:
 *   cross-env EXPIRED_TOKEN=$(node scripts/aged-token.cjs) npm run kpost
 * aged-token.cjs prints the token ONLY once it is genuinely past exp, so a too-early run simply
 * leaves EXPIRED_TOKEN empty and the checks skip as before — never a false "rejected" from a token
 * that was actually still valid.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const API = (process.env.KPOST_API_BASE_URL || '').replace(/\/$/, '');
const OUT = path.join(__dirname, '..', '.auth', 'aging-token.json');

(async () => {
  const r = await fetch(`${API}/v2/signupLogin/userLogin/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceType: 'Web',
      deviceIdentity_primary: '9f9d6bd8-238f-11ed-b3e2-73ce62ed0e94',
      deviceIdentity_secondary: 'Desktop-Chrome',
      login_lattitude: 13.0476875,
      login_longitude: 80.2655737,
      oneSignal_Key: 'qa-bench',
      voip: 'voip',
      module: 0,
      sessionID: require('crypto').randomUUID(),
      kpostID: process.env.QA_KPOST_ID,
      loginRO: { countryID: String(process.env.QA_COUNTRY_ID || 1), password: process.env.QA_PASSWORD, userType: 'PERSONAL' },
      logintime: Date.now(),
    }),
  });
  const token = (await r.json()).accessToken;
  if (!token) {
    console.error('login did not return an accessToken — check QA_KPOST_ID / QA_PASSWORD');
    process.exit(1);
  }
  const claims = JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ token, exp: claims.exp, capturedAt: Math.floor(Date.now() / 1000) }, null, 2));
  const hrs = ((claims.exp - Date.now() / 1000) / 3600).toFixed(1);
  console.error(`captured. expires in ${hrs}h (at ${new Date(claims.exp * 1000).toISOString()}).`);
  console.error(`it becomes usable as EXPIRED_TOKEN after that time. saved to .auth/aging-token.json`);
})();
