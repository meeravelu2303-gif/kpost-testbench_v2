/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { AUTH_PROFILES } from '@config/auth-profile';
import type { Principal } from '@config/auth.config';
import { expect, test } from '@fixtures';

/**
 * Dashboard **business-rule flow** — beyond the generic schema/auth sweep (`read.spec.ts`), this
 * verifies what the Home recent-messages panel is actually FOR: `homeDashboardMsgs` and
 * `katchupDashboardMsg` both describe "the current recent-activity window" for the same account, and
 * a caller reading either must see the same window, not two independently-drifting views.
 *
 * `homeDashboardNewMsgs` (the incremental "only newer than a marker" refresh) is `destructive: false`
 * with no `productionSafe` flag (a null marker 500s the backend — see its definition's note), so it
 * needs `allowLiveRead` to run here at all, fed the REAL `firstMsgID`/`LastFetchDate` marker a prior
 * `homeDashboardMsgs` call just returned.
 */

const A: Principal = AUTH_PROFILES.kpost.principals.find((p) => p.key === 'personal')!;

interface DashboardWindow {
  LastFetchDate?: string;
  firstMsgID?: number;
  lastMsgID?: number;
  katchup?: Array<{ msgID: number }>;
}

test.describe('KPost Dashboard · feature flow @api @dashboard', () => {
  test('homeDashboardMsgs: the recent-activity window is internally consistent', async ({
    endpoints,
  }) => {
    const ex = await endpoints.sendTo(
      'dashboard-home-msgs',
      { body: { serverTime: null, lastMsgID: null } },
      { label: 'dashboard:home', auth: { principal: A } },
    );
    expect(ex.status, 'homeDashboardMsgs succeeds for an authenticated read').toBe(200);
    const body = JSON.parse(ex.bodyText ?? '{}') as DashboardWindow;

    // The panel's own ordering invariant: firstMsgID marks the newest message in the batch,
    // lastMsgID the oldest, so a batch is never reported first < last.
    if (body.firstMsgID !== undefined && body.lastMsgID !== undefined) {
      expect(
        body.firstMsgID,
        'firstMsgID (newest) is not less than lastMsgID (oldest) in the same batch',
      ).toBeGreaterThanOrEqual(body.lastMsgID);
    }

    if (body.katchup?.length) {
      const ids = body.katchup.map((m) => m.msgID);
      expect(ids[0], "the first katchup entry is the batch's firstMsgID").toBe(body.firstMsgID);
      expect(ids[ids.length - 1], "the last katchup entry is the batch's lastMsgID").toBe(
        body.lastMsgID,
      );
      const sorted = [...ids].sort((a, b) => b - a);
      expect(ids, 'katchup entries are ordered newest-first (descending msgID)').toEqual(sorted);
    }
  });

  test('katchupDashboardMsg reports the SAME recent-activity window as homeDashboardMsgs, not a drifted copy', async ({
    endpoints,
  }) => {
    const [home, katchup] = await Promise.all([
      endpoints.sendTo(
        'dashboard-home-msgs',
        { body: { serverTime: null, lastMsgID: null } },
        { label: 'dashboard:home-for-consistency', auth: { principal: A } },
      ),
      endpoints.sendTo(
        'dashboard-katchup-msg',
        { body: { serverTime: null } },
        { label: 'dashboard:katchup-for-consistency', auth: { principal: A } },
      ),
    ]);
    expect(home.status, 'homeDashboardMsgs succeeds').toBe(200);
    expect(katchup.status, 'katchupDashboardMsg succeeds').toBe(200);

    const homeBody = JSON.parse(home.bodyText ?? '{}') as DashboardWindow;
    const katchupBody = JSON.parse(katchup.bodyText ?? '{}') as DashboardWindow;

    // Both are read moments apart for the same account; the marker triple is the panel's definition
    // of "current window" and must match, or the two surfaces are silently drifting.
    expect(katchupBody.LastFetchDate, 'LastFetchDate matches between the two dashboard reads').toBe(
      homeBody.LastFetchDate,
    );
    expect(katchupBody.firstMsgID, 'firstMsgID matches between the two dashboard reads').toBe(
      homeBody.firstMsgID,
    );
    expect(katchupBody.lastMsgID, 'lastMsgID matches between the two dashboard reads').toBe(
      homeBody.lastMsgID,
    );

    const homeKatchupIds = (homeBody.katchup ?? []).map((m) => m.msgID);
    const katchupIds = (katchupBody.katchup ?? []).map((m) => m.msgID);
    expect(
      katchupIds,
      "katchupDashboardMsg's katchup array is the same data homeDashboardMsgs embeds, not an independent query",
    ).toEqual(homeKatchupIds);
  });

  test('homeDashboardNewMsgs: fed a real marker, succeeds and returns only messages newer than it', async ({
    endpoints,
  }) => {
    const home = await endpoints.sendTo(
      'dashboard-home-msgs',
      { body: { serverTime: null, lastMsgID: null } },
      { label: 'dashboard:home-for-marker', auth: { principal: A } },
    );
    expect(home.status, 'homeDashboardMsgs succeeds').toBe(200);
    const homeBody = JSON.parse(home.bodyText ?? '{}') as DashboardWindow;
    test.skip(
      homeBody.firstMsgID === undefined || homeBody.LastFetchDate === undefined,
      'no real marker available on this account right now (empty recent-activity window)',
    );

    const withRealMarker = await endpoints.sendTo(
      'dashboard-home-new-msgs',
      { body: { firstMsgID: homeBody.firstMsgID, serverTime: homeBody.LastFetchDate } },
      { label: 'dashboard:new-with-real-marker', auth: { principal: A }, allowLiveRead: true },
    );
    expect(
      withRealMarker.status,
      "a real marker succeeds (contrasted with a null marker, which the endpoint's own note says 500s)",
    ).toBe(200);

    const newBody = JSON.parse(withRealMarker.bodyText ?? '{}') as DashboardWindow;
    for (const entry of newBody.katchup ?? []) {
      expect(
        entry.msgID,
        `entry ${entry.msgID} must be newer than the firstMsgID marker (${homeBody.firstMsgID}) it was fetched after`,
      ).toBeGreaterThan(homeBody.firstMsgID as number);
    }
  });
});
