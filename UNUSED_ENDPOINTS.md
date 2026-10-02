# Unused / dead endpoints — evidence-based, not assumed

Per the 2026-10-02 scope-rebuild directive: an endpoint is only listed here when its lack of a
caller was **proven** (exhaustive grep across `KPOST_REACTJS_2023_V1/src/` outside the defining
file, or an explicit "legacy"/dead-code marker in the source itself) — never because the test
bench simply doesn't have a test for it yet. This file is a byproduct of the frontend-call-tracing
agent dispatched from `TEST_BENCH_100_PERCENT_PLAN.md` §24, cross-referencing every exported
function in every `src/Services/*.js` file against every other file in the frontend repo.

This is a **first pass**, covering what that trace found. It does not yet include backend
endpoints that exist in `KPOST_V5.0`/`Kpost_Kmail_5.0`/`Admin_Module` but were never modeled in
`src/Services/*.js` at all (a different, not-yet-done kind of "unused" — those need tracing from
the backend side, not the frontend side, and are out of scope for this file until that pass runs).

| Endpoint | Module | Evidence | Reason | Decision |
|---|---|---|---|---|
| `POST /profile/updateProfileImage/` (via `ProfileImage.js#updateProfile`) | Profile | Grep for any import of `Services/ProfileImage` anywhere in `src/` returns zero matches | Dead frontend wrapper file — **the backend endpoint itself is NOT unused**: `Katchup.js#ProfileUpload` calls the identical path and has confirmed real callers | Backend endpoint stays in scope (tested via the live Katchup caller); the `ProfileImage.js` frontend file itself is dead code, not a test-bench concern |
| `POST /profile/removeProfileImage/` (via `ProfileImage.js#removeProfile`) | Profile | Same as above | Same as above — `Katchup.js#DeletePicUpload` (GET variant) is the live equivalent path `/profile/removeProfileImage/` | Backend endpoint stays in scope; frontend file is dead code |
| `POST https://api.tapay.in/v2/paymentrequest` (`KBooking.js#getpaymentgatewayUI`) | KBooking | Grep for `getpaymentgatewayUI` outside its own definition returns zero matches | No caller anywhere in `src/`; also not a KPost backend endpoint at all (third-party host) | UNUSED — not applicable to backend test coverage regardless |
| `POST http://192.168.2.41:8989/taWallet/paymentRequest1` (`KBooking.js#redirectui`) | KBooking | Grep for `redirectui` outside its own definition returns zero matches | No caller anywhere in `src/`; hard-coded LAN IP, looks like leftover dev-only code | UNUSED — not applicable to backend test coverage |
| `GET https://devapi2.kpostindia.com/redbus/destinations/` (`Katchup.js#toBusGetFun`) | Katchup (misplaced) | Grep for `toBusGetFun` outside its own definition returns zero matches | No caller anywhere in `src/`; dead duplicate of `KBooking.js#GetDestinations`, and its hard-coded URL is missing the `/v2` segment the real one uses — would hit a different route shape even if called | UNUSED — the real, live path is `KBooking.js#GetDestinations`, already in scope |
| `GET .../rss2json.../rss_url=http://feeds.bbci.co.uk/...` (`KNews.js#Get_BBCNews`) | KNews | Explicitly commented "LEGACY FEED FUNCTIONS (kept for backwards compatibility)"; zero callers found | Confirmed legacy, confirmed dead | UNUSED — also third-party (RSS aggregator), not a KPost backend endpoint |
| `Get_HinduNews` (KNews.js) | KNews | Same comment block, zero callers | Same | UNUSED — third-party |
| `Get_CNNNews` (KNews.js) | KNews | Same comment block, zero callers; note the function name is misleading — the URL it actually fetches is a Tamil Zee News sports feed, not CNN | Same | UNUSED — third-party |
| `Get_ZeeNews` (KNews.js) | KNews | Same comment block, zero callers | Same | UNUSED — third-party |
| `getFeedState` (KNews.js) | KNews | Grep for callers outside its own file returns zero matches | No caller found | UNUSED — internal helper, never invoked |
| `LANG_LABELS`, `CITY_REGIONS` data exports (KNews.js) | KNews | Grep for usage outside KNews.js returns zero matches | No caller found | UNUSED — dead data exports |

## Entire module confirmed out of scope for backend coverage (not "unused endpoints", but related)

- **KNews** — confirmed to never call the KPost backend at all (no `EndPointURL`/`KmailEndPointURL` import anywhere in `KNews.js`); 100% third-party RSS aggregation via `rss2json.com` and two CORS proxies. Already correctly marked `NOT_APPLICABLE` in `TEST_BENCH_100_PERCENT_PLAN.md`'s module inventory — this trace confirms it with full evidence rather than inference.

## Dead/stale imports found (not endpoints, but worth fixing)

`Home.js`, `Kdirectory.js`, `Katchup.js`, `Kmail.js` import `EndPointURLS`/`LocalURL` (and `Katchup.js` also imports `BusURL`/`LocalEndPointURL`) from `ServiceURL.js` — **none of these names are actually exported there**, so they resolve to `undefined` at import time. Grep confirms they're never referenced in live (non-commented) code paths today, so this isn't a live bug, but it's stale code that would silently build a URL containing the literal string `"undefined"` if anyone ever used it. Flagged for the frontend team, not a test-bench action item.

| `POST /redbus/boardingPoint/` (workbook-documented, no frontend wrapper) | KBooking | Exhaustive grep of `KPOST_REACTJS_2023_V1/src/` for "boardingpoint"/"boarding" found no `Services/KBooking.js` wrapper and no caller; boarding/dropping-point data is populated client-side from the `tripdetails` response's embedded `boardingTimes[]`/`droppingTimes[]` arrays instead (`KBook.js` multiple lines) | No wrapper function exists at all — stronger than "dead code", this endpoint is simply never called by the current frontend build, which gets the same data a different way | Category B — UNUSED (not built); re-check if the frontend ever adds a dedicated boarding-point picker |
| `POST /redbus/tripdetailsV2/` (workbook-documented, no frontend wrapper) | KBooking | Exhaustive grep of `KPOST_REACTJS_2023_V1/src/` for "tripdetailsv2" returns zero hits; only the non-V2 `FetchTripDetails` (→ `/redbus/tripdetails/`, already covered) exists, including a dead commented-out duplicate of the SAME non-V2 path, not a V2 variant | No wrapper, no caller, no trace of a V2 integration anywhere | Category B — UNUSED (not built) |
| `POST /redbus/updatecitylist` (workbook-documented, no frontend wrapper) | KBooking | Exhaustive grep of `KPOST_REACTJS_2023_V1/src/` for "updatecitylist"/"citylist" returns zero hits; only read-only `GetCitySuggestionByQuery`/`GetDestinations` exist, no "update" operation anywhere | No wrapper, no caller | Category B — UNUSED (not built) |

## Genuinely unresolved (not "unused", needs a decision)

- **KPoster's ~18 real REST routes** (`bootstrap`, `profiles/*`, `posts/*`, `events`, `reports`, `notifications/read`, `analytics`, `attachments`) — the frontend's own default build (`KPOSTER_DEMO = true` unless `REACT_APP_KPOSTER_MODE=api`) never calls any of them; it runs against a local IndexedDB demo store instead. This is **not** "unused" in the usual sense — the code is real and would be called under a different build config. Whether the actual deployed, real-world build sets `REACT_APP_KPOSTER_MODE=api` is a deployment fact this session cannot read from source. **Decision: UNKNOWN, needs the real deployed config confirmed before these routes can be correctly classified either way** — not guessed, not silently excluded.
