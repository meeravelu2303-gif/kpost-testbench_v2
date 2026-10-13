# Soft-assertion → hard-assertion proposals (FR-GM-010/011/012/013/014)

**Proposals only — not applied.** The group member/admin tests in
`tests/api/kpost/group/feature.spec.ts` use `expect.soft(...)`, which records a finding but lets the
test pass. Per the brief, convert them to hard `expect(...)`; and where the product is currently wrong,
move that check into its own test marked `test.fail()` + a `@bug-<id>` annotation so it flags
automatically the moment the bug is fixed.

Why `expect.soft` here is a problem: a soft failure never turns the run red, so a real BR violation
(e.g. a group left with zero admins) is invisible unless someone reads the report. Hard assertions make
the regression suite the source of truth.

---

## 1. FR-GM-010 / FR-GM-011 — member add/remove reflected in the group (lifecycle test, ~line 215–230)

The post-step rechecks are soft. The count/membership either changed or it didn't — assert it hard.

```diff
       if (status < 300 && id === 'group-edit-name') {
         const details = await groupDetails(endpoints, A, groupKpostID);
-        expect
-          .soft(details.groupKpostName, 'group-edit-name actually renamed the group')
-          .toBe('QA Bench Renamed');
+        expect(details.groupKpostName, 'FR-GM-008: group-edit-name actually renamed the group')
+          .toBe('QA Bench Renamed');
       }
       if (status < 300 && id === 'group-add-user') {
         const details = await groupDetails(endpoints, A, groupKpostID);
         const members = (details.memberDetails ?? []) as Array<Record<string, unknown>>;
-        expect
-          .soft(
-            Array.isArray(members) && members.some((m) => m.kpostID === C.username),
-            'group-add-user actually added the member to the group',
-          )
-          .toBe(true);
+        expect(
+          Array.isArray(members) && members.some((m) => m.kpostID === C.username),
+          'FR-GM-010: group-add-user actually added the member to the group',
+        ).toBe(true);
       }
```

Also add the requirement links to this lifecycle test's options (it currently has none):

```diff
-    test('create → add member → admin → rename → image → leave → remove → delete @api @group', async ({
+    test('create → add member → admin → rename → image → leave → remove → delete @api @group', {
+      annotation: [
+        { type: 'requirement', description: 'FR-GM-010' },
+        { type: 'requirement', description: 'FR-GM-011' },
+        { type: 'requirement', description: 'FR-GM-008' },
+      ],
+    }, async ({
```

Risk: low. These rechecks are expected to pass today (the FRD marks them 🟡 only because they were
asserted softly, not because the product is known wrong).

## 2. FR-GM-012 / FR-GM-013 — promote/demote stored (test at ~line 241; ~line 310, 319, 346)

```diff
-          expect.soft(promote.status, 'promote to admin is accepted (FR-GM-012)').toBeLessThan(300);
+          expect(promote.status, 'FR-GM-012: promote to admin is accepted').toBeLessThan(300);
...
-          expect
-            .soft(/* admin_access grant */ , 'FR-GM-012: the grant is stored on the membership row')
-            .toBe('Y');
+          expect(/* admin_access grant */ , 'FR-GM-012: the grant is stored on the membership row').toBe('Y');
...
-          expect
-            .soft(afterDemote?.admin_access, 'FR-GM-013: the revoke is stored, not just reported')
-            .toBe('N');
+          expect(afterDemote?.admin_access, 'FR-GM-013: the revoke is stored, not just reported')
+            .toBe('N');
```

Add `{ type: 'requirement', description: 'FR-GM-013' }` to this test's existing annotation array (it
already carries FR-GM-012). Risk: low (promote/demote work live, verified 2026-10-02).

## 3. FR-GM-014 — sole admin cannot exit (CURRENTLY A FINDING → extract + `test.fail()`)

This is the one where the product may be wrong: the BR is described as UI-only, and a live exit by the
sole admin has been seen to return 2xx (recorded as a finding). It is also mixed into the FR-GM-012/013
test, so a plain hard assert would wrongly fail the passing promote/demote checks. **Extract it into its
own test**, assert hard, and mark `test.fail()` with a bug annotation so it goes green exactly when the
backend starts enforcing the rule:

```diff
+    test(
+      'FR-GM-014 — the sole admin cannot exit; the group keeps >=1 admin @api @group @security',
+      {
+        annotation: [
+          { type: 'requirement', description: 'FR-GM-014' },
+          { type: 'bug', description: 'KPOST-<file-me>' }, // server allows zero-admin exit (BR is UI-only)
+        ],
+      },
+      async ({ endpoints, databases }) => {
+        // ...set up A(sole admin) + group, attempt A's exit...
+        const admins = await database.findMany({
+          table: 'TBL_KPOST_USERGROUP_MEMBERDETAILS',
+          where: { group_id: groupID, admin_access: 'Y', removed_flag: 0 },
+        });
+        // Marked test.fail(): the backend currently does NOT enforce this (exit leaves zero admins).
+        // When the fix lands, this expectation passes and Playwright reports the test.fail() as a
+        // "passed unexpectedly" failure — a loud signal to drop the test.fail() and the bug annotation.
+        test.fail();
+        expect(admins.length, 'FR-GM-014: the group retains at least one admin after a sole-admin exit')
+          .toBeGreaterThan(0);
+      },
+    );
```

And remove the soft FR-GM-014 block (lines ~350–376) from the combined FR-GM-012/013 test so that test
asserts only what passes today.

Risk: medium — needs the Bugzilla id (file the zero-admin-exit finding first, then replace
`KPOST-<file-me>`). Until the id exists, leave this proposal unapplied.

---

### Also worth the same treatment (not in the brief, flagged for consistency)

- **FR-GC-006** — a solo-member group is accepted live (200) though the rule requires ≥1 other member
  (known violation, 2026-10-02). Same pattern: hard-assert the rejection in its own `test.fail()` +
  bug-annotation test.
- **BR-KU-DISAPPEAR-READ / -SCHED** (#976) and **BR-KU-FORWARD-HIDE** (#972) are already filed; their
  specs should carry `{ type: 'bug', description: 'KPOST-976' }` / `'KPOST-972'` annotations and a
  `test.fail()` on the specific expectation, so they auto-flag when fixed.
