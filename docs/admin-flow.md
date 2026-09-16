# Admin module — flow, endpoints, accounts, and test plan

The authoritative map of the KPost **Admin module** (organisation / workplace / HR setup), the way
`katchup-flow.md` / `kall-flow.md` / `kmail-flow.md` are for their modules. Source: the owner's
walkthrough (2026-09-15) + the live signup/user-management screens + `Admin_module.xlsx` (converted to
`openapi/admin-api.openapi.json`).

> Secrets rule: KPost IDs are listed here as identifiers (like the personal QA accounts in CLAUDE.md);
> passwords live only in `.env`. The shared QA password is the standard one already recorded in the repo.

---

## 1. Two DIFFERENT admin surfaces — do not conflate them

There are two distinct "admin" things, and they are separate hosts, separate products, reached by
different tiers:

| Surface                     | Who reaches it                           | Where                                                                                                       | Bench product                                        |
| --------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **In-app User Management**  | **BUSINESS_S** admin                     | `account.kpostindia.com/usermanagement` (inside the KPost app)                                              | core `kpost-api` (`/admin/*` etc. on `devapi2`)      |
| **Admin / HR Setup module** | **BUSINESS_M** and **BUSINESS_L** admins | opens a NEW TAB → **UI `https://kpostadmin.kpostindia.com/`**, **API `https://adminmodule.kpostindia.com`** | new **`admin-api`** (this doc / `Admin_module.xlsx`) |

So `admin-api` (the 35 endpoints just converted) is the **BUSINESS_M/L** Admin/HR-Setup module. The
BUSINESS_S "add users" flow is a **different** surface on the core app, not this one.

---

## 2. User types and signup

**Two account types:** `PERSONAL` and `BUSINESS`. Business has three tiers: **BUSINESS_S / \_M / \_L**.
(The signup screen also shows **Institutions** and **Governments** verticals — out of current scope.)

**Signup → business account** (`account.kpostindia.com/signup`):

1. "KPOST Verticals — Select Account Option": Personal / **Business** / Institutions / Governments.
2. Business → **Category**: **Small** (orgs up to 250 users) · **Medium** (above 250 up to 2000) ·
   **Large** (above 1500). _(Observed copy: Medium "up to 2000" and Large "above 1500" overlap — a
   possible UI-copy finding, recorded, not chased.)_
3. Choose category → enter **company details + admin details** → the system creates a **KPost ID for
   the company admin**. The tier is part of the credential.

---

## 3. BUSINESS_S — create users IN-APP (no OTP)

The BUSINESS_S admin logs into the KPost app and has a **User Management** module (not the Admin/HR
module). Flow:

`User Management` → **Business User Management** (Total Licenses e.g. 250; Add New / Allocated /
Unallocated channels) → **Add New Channels** → modal **"Add Communication Channels"**: **Add Manually**
_or_ **Bulk-Upload MS Excel File From Web Application** → enter the user's data → **Add** →
**the user is created, with NO OTP verification.**

This is how a Small company populates its members directly inside the app. (These created members show
in the Business C.C Channels list with role/name, e.g. Java Developer Trainee, Senior Software
Developer, Web Developer.)

---

## 4. BUSINESS_M / BUSINESS_L — the Admin / HR Setup module

The M/L admin has an **"Admin / HR Setup"** nav item; clicking it **opens a new tab** at
`https://kpostadmin.kpostindia.com/` (API `https://adminmodule.kpostindia.com`). Company users are
built here through a **strict ordered sequence** — each step depends on the previous:

| #   | Step (UI module)                                           | What you do                                                                                                                                                               | Bench endpoints (`admin-api`)                                                                                                                                                             |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Work Place Setup** (Tier + Variables tabs)               | Create a **tier** first, then its **variables**. e.g. tier `category of workplace` → var `Administration`; tier `type of workplace` → vars `Head office`, `Zonal office`. | tiers: `adminTierAttribute/{save,update,delete,getAttributeByCompanyId}` · variables: `adminTierVariable/{save,update,delete,getAdminTierVariable}`                                       |
| 2   | **Work Place Location Setup**                              | Create the **locations** for those workplaces.                                                                                                                            | `location/{save,update,delete,getAllLocation,getLocation,getLocationById}` · read tree: `workplaceHierarchy/getWorkPlaceHierarchy`                                                        |
| 3   | **Human Resource → HR Breakdown Setup** (Tier + Variables) | Create the HR **tiers** (e.g. `Department`, `Designation`, `Role`), then their **variables** (e.g. `IT`, `Developer`, `Team Lead`).                                       | tiers: `hrSetUpTierAttribute/{save,update,delete,getAttributeByCompanyId}` · variables: `hrSetUpTierVariable/{save,update,getHrSetUpTierVariable,getAllReportingHrTierVariableHierarchy}` |
| 4   | **Role Posting Setup**                                     | **Map roles to a workplace.**                                                                                                                                             | `rolePosting/{save,update,delete,getRolePostingByCompanyId}`                                                                                                                              |
| 5   | **Employee Data**                                          | Enter **employee details** → create the employee. (Address helper: pincode→address.)                                                                                      | `employeeDetails/{save,update,delete,getEmployeeDetails}` · `country/getAddressUsingPincodeAndCountry/{pincode}/{country}`                                                                |
| 6   | **Assign Role Posting**                                    | **Assign a role to an employee.** **Rule: one role PER employee** — 4 junior java developers get 4 distinct roles (`jr java developer 1`, `jr java developer 2`, …).      | `rolePosting/getEmployeeByCompanyId` · assign via `rolePosting/*` · suspend/terminate: `rolePosting/suspendOrTerminateEmployee`, read: `rolePosting/getSuspendOrTerminateEmployee`        |

**Endpoint→step mapping is inferred from endpoint naming** (`adminTier*` = Work Place Setup;
`hrSetUpTier*` = HR Breakdown Setup) and must be **confirmed on the first live read** — the workbook's
sample payloads use generic values (`attributeName: "Department"`, `variableName: "Sales"`) that don't
themselves prove which system is which.

---

## 5. QA business accounts (owner-created, live)

Passwords are the standard QA password; they belong in `.env`, not here.

| Tier       | Company                     | Admin KPost ID                      | Members created?                                                                                                                     |
| ---------- | --------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| BUSINESS_S | QA Small Technologies       | `sma.qa@kpost.in` (mob 8985654756)  | **Yes** — 3 users: `qasmjadetr.qa@kpost.in` (8952147563), `qasmsesode.qa@kpost.in` (9977885544), `qasmwede.qa@kpost.in` (9325687412) |
| BUSINESS_M | QA Test Medium Technologies | `qam.qt@kpost.in` (mob 9988775544)  | **No** — admin only; company users to be supplied (created via the Admin/HR module)                                                  |
| BUSINESS_L | QA (Large) Technologies     | `qal.qtl@kpost.in` (mob 8899774454) | **No** — admin only; company users to be supplied (same Admin/HR flow as M)                                                          |

Business accounts are on **`@kpost.in`** (personal is `@kpostindia.com`).

**What this unblocks:** the Admin module was previously blocked on "a business company with ≥3 members".
BUSINESS_S now HAS members → the core `/admin/*` business-admin operations (member reads, and — very
carefully, on an expendable member — hold/terminate) become testable. BUSINESS_M gives a clean slate to
drive the full Admin/HR-Setup create sequence end-to-end and self-clean.

---

## 6. Auth & ids — ANSWERED by the owner (2026-09-15)

1. **Auth for `adminmodule.kpostindia.com`: the SAME KPost login token.** SSO — the token minted by the
   business admin's KPost login works unchanged on the admin module; there is **no separate admin login**.
   **Verified on live (2026-09-15):** all three business admins log in via plain **`userLogin`** (not
   `adminUserLogin`, which answers 403 for these accounts), and the token carries `companyID` + `role:
admin`. That Bearer token authenticates every `admin-api` call. Discovered company ids:
   **S = 1066, M = 1067, L = 1075** (in `.env` as `QA_BUSINESS_{S,M,L}_COMPANY_ID`).

   **FINDING — auth is not enforced on a missing/malformed token.** The admin `AuthenticationFilter`
   only rejects a token that is present-but-invalid (401); a request with **no** `Authorization` header,
   an empty token, or a non-Bearer scheme passes through unauthenticated and the endpoint answers **200**
   (or 500). Confirmed on live and in the backend source. Filed as CRITICAL to KPost Admin.

2. **`companyId` comes from the TOKEN, not a hand-entered value.** The JWT carries the admin's own
   `companyID`; payloads use it. Two consequences: (a) the token provider/definition reads `companyID`
   from the decoded token and fills the payload's `companyId` with it, so a request always targets the
   caller's OWN company; (b) the QA-identifier guard must **allow a `companyId` that equals the
   authenticated principal's own token `companyID`** (a caller cannot reach another tenant with its own
   id). Discover each company's numeric id on the first login (decode the token) and record it as
   `QA_BUSINESS_{S,M,L}_COMPANY_ID` in `.env` for the guard allowlist.

**Still to verify at first live read (not blockers):**

3. **Ordering / referential ids.** `save` returns an id used by the next step (variable needs
   `attributeId`; location/role/employee chain on). Like KDiary, read one entity back before trusting an
   id field. Self-clean deletes in reverse dependency order.
4. **Which writes are safe to drive on live.** All are on our OWN QA companies → safe, self-cleaning. The
   one to guard is `rolePosting/suspendOrTerminateEmployee` — only ever on an expendable member we
   created, never a seeded one.

---

## 7. Test plan

1. **Convert (done):** `admin-api` OpenAPI/contract generated from `Admin_module.xlsx`.
2. **Register:** `admin-api` endpoint definitions + suite (`defineAdminEndpoint`), host
   `adminmodule.kpostindia.com`, auth per §6.1. Reads = `productionSafe`; writes = gated lifecycle.
3. **Live reads:** the `get*` endpoints on the BUSINESS_M/S companies (contract validators).
4. **Write lifecycle** (gated `ADMIN_LIFECYCLE=true`, self-cleaning) on BUSINESS_M: run the full §4
   sequence — workplace tier→variable→location, HR tier→variable, role posting, employee, assign role —
   then delete in reverse. Proves the whole org-setup flow.
5. **UI:** the Admin/HR Setup screens at `kpostadmin.kpostindia.com` (screen render + the check sweep +
   the create flows, gated). Routes to Bugzilla **KPost Admin → Jaganathan** (UI → Ayyappan for UI bugs).
