import { AUTH_PROFILES } from '@config/auth-profile';
import { STORAGE_STATE_ADMIN } from '@config/constants';
import { env } from '@config/env';
import { testData } from '@config/test-data.config';
import { test as setup } from '@fixtures';

/**
 * Seeds the **Admin / HR-Setup UI** session (`kpostadmin.kpostindia.com`, a CoreUI SPA) for the
 * `admin-ui` project. That app has **no login screen of its own** — it is SSO'd by the same KPost
 * token, planted in this origin's `localStorage`, exactly as the app's own `Callback.js` does:
 *
 *   1. mint a BUSINESS_M token via the API (the admin module is business-tier only),
 *   2. GET `/v2/profile/getUserProfile/` — the app seeds `AuthUser` + `companyID` from `data.data`,
 *   3. write `accessToken`, `AuthUser`, `companyID` (+ the CoreUI light-theme key) on the admin origin,
 *   4. save the state.
 *
 * Only does the real seed when an admin-UI spec will run (`ADMIN_UI_LIFECYCLE=true`) AND BUSINESS_M
 * and the admin host are configured; otherwise it saves an anonymous state and the admin-UI specs
 * self-skip — so a normal run never touches the admin host.
 */
setup('authenticate admin UI (BUSINESS_M SSO)', async ({ page, endpoints, log }) => {
  const wanted = process.env.ADMIN_UI_LIFECYCLE === 'true';
  const adminUrl = env.ADMIN_UI_BASE_URL;
  const businessM = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'business-m');
  const configured = Boolean(
    adminUrl &&
    businessM &&
    testData.businessMKpostId &&
    !testData.businessMKpostId.includes('qa.business'),
  );

  if (wanted && configured && adminUrl && businessM) {
    // 1. A real BUSINESS_M token (the admin module authenticates the same KPost token).
    const token = await endpoints.tokens.tokenFor(businessM, AUTH_PROFILES.kpost);

    // 2. The profile the admin Callback.js seeds AuthUser + companyID from.
    let authUser: Record<string, unknown> = {};
    let companyID: string = String(testData.businessMCompanyId);
    const profileUrl = `${env.KPOST_API_BASE_URL ?? env.API_BASE_URL}/v2/profile/getUserProfile/`;
    const res = await page.request.get(profileUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok()) {
      const data = (await res.json()) as { data?: Record<string, unknown> };
      authUser = data.data ?? {};
      const raw = authUser.companyID;
      companyID =
        typeof raw === 'string' || typeof raw === 'number'
          ? String(raw)
          : String(testData.businessMCompanyId);
    }

    // 3. Plant the SSO keys on the admin origin exactly as Callback.js does, then 4. save.
    await page.goto(adminUrl, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      ({ token, authUser, companyID }) => {
        localStorage.setItem('accessToken', token);
        localStorage.setItem('AuthUser', JSON.stringify(authUser));
        localStorage.setItem('companyID', companyID);
        localStorage.setItem('coreui-free-react-admin-template-theme', 'light');
      },
      { token, authUser, companyID },
    );
    log.info(`Seeded admin UI SSO for ${testData.businessMKpostId} (company ${companyID})`);
  } else {
    log.info('admin UI suite not requested or not configured; saving anonymous admin state');
  }

  await page.context().storageState({ path: STORAGE_STATE_ADMIN });
});
