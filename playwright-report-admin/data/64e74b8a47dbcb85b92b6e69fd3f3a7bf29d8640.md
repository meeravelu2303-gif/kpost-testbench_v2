# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: api\admin\feature.spec.ts >> Admin/HR org-setup lifecycle (BUSINESS_M) >> workplace + HR + employee: create → read-back → self-clean @api @admin-api
- Location: tests\api\admin\feature.spec.ts:109:7

# Error details

```
Error: workplace tier variable saved

expect(received).toMatch(expected)

Expected pattern: /success/i
Received string:  "FAILURE"
```

```
Error: workplace tier variable returns an id

expect(received).toBeTruthy()

Received: undefined
```

```
Error: HR tier attribute saved

expect(received).toMatch(expected)

Expected pattern: /success/i
Received string:  "FAILURE"
```

```
Error: HR tier attribute returns an id

expect(received).toBeTruthy()

Received: undefined
```

```
Error: the newly created HR tier attribute appears in the company list

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  260 |         );
  261 |         expect.soft(statusOf(locAll), 'all locations read').toMatch(/success/i);
  262 |         const locGet = await call(
  263 |           endpoints,
  264 |           'admin-workplace-location-get',
  265 |           { attributeId: wpAttrId, variableId: wpVarId },
  266 |           'loc-get',
  267 |         );
  268 |         expect.soft(statusOf(locGet), 'locations by tier read').toMatch(/success/i);
  269 |         if (locId) {
  270 |           const locById = await call(
  271 |             endpoints,
  272 |             'admin-workplace-location-by-id',
  273 |             { id: locId },
  274 |             'loc-by-id',
  275 |           );
  276 |           expect.soft(statusOf(locById), 'location by id read').toMatch(/success/i);
  277 | 
  278 |           // Exercise the location UPDATE write.
  279 |           const locEdited = name('Location edited');
  280 |           const locUpd = await call(
  281 |             endpoints,
  282 |             'admin-workplace-location-update',
  283 |             { id: locId, locationName: locEdited },
  284 |             'loc-update',
  285 |           );
  286 |           expect.soft(statusOf(locUpd), 'workplace location updated').toMatch(/success/i);
  287 | 
  288 |           // Live-verified 2026-09-26: re-read the SAME location by id (the exact endpoint already
  289 |           // used above) and confirm the new name actually landed, not just that the write said so.
  290 |           const locRecheck = await call(
  291 |             endpoints,
  292 |             'admin-workplace-location-by-id',
  293 |             { id: locId },
  294 |             'loc-recheck',
  295 |           );
  296 |           const locRecheckValue = envelope(locRecheck).value;
  297 |           expect
  298 |             .soft(
  299 |               isPlainObject(locRecheckValue) && locRecheckValue.locationName === locEdited,
  300 |               'the updated location name actually persisted',
  301 |             )
  302 |             .toBe(true);
  303 |         }
  304 |       }
  305 | 
  306 |       /*
  307 |        * Fixed 2026-09-26, found while adding new coverage to this file (unrelated to it): this call
  308 |        * always threw before reaching the HR/employee/role-posting sections below, so none of those
  309 |        * had ever actually run to completion in this suite's history. Two bugs, both now fixed:
  310 |        *   1. `admin-workplace-hierarchy` is `destructive: false`, not `productionSafe` — it needs
  311 |        *      `allowLiveRead`, not `allowLiveWrite` (the `call()` helper's blanket flag, fine for the
  312 |        *      other `productionSafe` reads in this file, doesn't unlock this one).
  313 |        *   2. Its own definition documents "400 without a real parentAttributeId" — the call sent only
  314 |        *      `{ companyId }`, never the real one this test already minted (`wpAttrId`/`wpVarId`).
  315 |        * Fixing those two unblocked everything below (HR/employee/role-posting never used to run at
  316 |        * all), but the endpoint's own contract is still Unknown/Requires Clarification: a real Mongo
  317 |        * ObjectId in `parentAttributeId`/`parentVariableId` gets 400 "Request parameter is invalid" —
  318 |        * a DIFFERENT error than the "…is required" it gives with none at all, so some value is
  319 |        * expected but a real id isn't accepted either. No confirmed payload produces 200 yet. Left
  320 |        * soft (not hard) so this genuine, still-open finding doesn't block the sections after it.
  321 |        */
  322 |       const hierarchy = await endpoints.sendTo(
  323 |         'admin-workplace-hierarchy',
  324 |         { body: { parentAttributeId: wpAttrId ?? '0', parentVariableId: wpVarId ?? '0' } },
  325 |         { label: 'feature:admin:hierarchy', auth: { principal: businessM! }, allowLiveRead: true },
  326 |       );
  327 |       expect
  328 |         .soft(
  329 |           statusOf(hierarchy),
  330 |           'workplace hierarchy read (Unknown/Requires Clarification — see comment above)',
  331 |         )
  332 |         .toMatch(/success/i);
  333 | 
  334 |       // ---- HR Breakdown Setup: tier attribute → variable -------------------------------------
  335 |       const hrAttr = await call(
  336 |         endpoints,
  337 |         'admin-hr-tier-attribute-save',
  338 |         [{ attributeName: name('HR Tier') }],
  339 |         'hr-attr-save',
  340 |       );
  341 |       hrAttrId = createdId(hrAttr);
  342 |       expect.soft(statusOf(hrAttr), 'HR tier attribute saved').toMatch(/success/i);
  343 |       expect.soft(hrAttrId, 'HR tier attribute returns an id').toBeTruthy();
  344 | 
  345 |       // Same real cross-check as the workplace side: the created attribute must actually show up on
  346 |       // a fresh company-scoped read, not just be claimed by the save response.
  347 |       const hrAttrList = await call(
  348 |         endpoints,
  349 |         'admin-hr-tier-attribute-by-company',
  350 |         {},
  351 |         'hr-attr-by-company',
  352 |       );
  353 |       expect.soft(statusOf(hrAttrList), 'HR tier attributes read back').toMatch(/success/i);
  354 |       const hrAttrRows = envelope(hrAttrList).value;
  355 |       expect
  356 |         .soft(
  357 |           Array.isArray(hrAttrRows) && hrAttrRows.some((r) => isPlainObject(r) && r.id === hrAttrId),
  358 |           'the newly created HR tier attribute appears in the company list',
  359 |         )
> 360 |         .toBe(true);
      |          ^ Error: the newly created HR tier attribute appears in the company list
  361 | 
  362 |       if (hrAttrId) {
  363 |         const hrVar = await call(
  364 |           endpoints,
  365 |           'admin-hr-tier-variable-save',
  366 |           [
  367 |             {
  368 |               variableName: name('HR Var'),
  369 |               attributeId: hrAttrId,
  370 |               parentVariableId: 0,
  371 |               parentAttributeId: 0,
  372 |               reportingJson: '[]',
  373 |             },
  374 |           ],
  375 |           'hr-var-save',
  376 |         );
  377 |         hrVarId = createdId(hrVar);
  378 |         expect.soft(statusOf(hrVar), 'HR tier variable saved').toMatch(/success/i);
  379 |         expect.soft(hrVarId, 'HR tier variable returns an id').toBeTruthy();
  380 |       }
  381 | 
  382 |       const hrVarList = await call(
  383 |         endpoints,
  384 |         'admin-hr-tier-variable-list',
  385 |         { parentVariableId: 0 },
  386 |         'hr-var-list',
  387 |       );
  388 |       expect.soft(statusOf(hrVarList), 'HR variables read back').toMatch(/success/i);
  389 |       if (hrVarId) {
  390 |         const hrReport = await call(
  391 |           endpoints,
  392 |           'admin-hr-tier-variable-reporting-hierarchy',
  393 |           { id: hrVarId },
  394 |           'hr-var-reporting',
  395 |         );
  396 |         expect.soft(statusOf(hrReport), 'HR reporting hierarchy read').toMatch(/success/i);
  397 |       }
  398 | 
  399 |       // Exercise the HR tier attribute + variable UPDATE writes.
  400 |       if (hrAttrId) {
  401 |         const hrAttrEdited = name('HR Tier edited');
  402 |         const hrAttrUpd = await call(
  403 |           endpoints,
  404 |           'admin-hr-tier-attribute-update',
  405 |           { id: hrAttrId, attributeName: hrAttrEdited },
  406 |           'hr-attr-update',
  407 |         );
  408 |         expect.soft(statusOf(hrAttrUpd), 'HR tier attribute updated').toMatch(/success/i);
  409 | 
  410 |         // Same field-level check as the workplace tier attribute update above.
  411 |         const hrAttrRecheck = await call(
  412 |           endpoints,
  413 |           'admin-hr-tier-attribute-by-company',
  414 |           {},
  415 |           'hr-attr-recheck',
  416 |         );
  417 |         const hrAttrRecheckRows = envelope(hrAttrRecheck).value;
  418 |         expect
  419 |           .soft(
  420 |             Array.isArray(hrAttrRecheckRows) &&
  421 |               hrAttrRecheckRows.some(
  422 |                 (r) => isPlainObject(r) && r.id === hrAttrId && r.attributeName === hrAttrEdited,
  423 |               ),
  424 |             'the updated HR tier attribute name actually persisted',
  425 |           )
  426 |           .toBe(true);
  427 |       }
  428 |       if (hrVarId) {
  429 |         const hrVarUpd = await call(
  430 |           endpoints,
  431 |           'admin-hr-tier-variable-update',
  432 |           {
  433 |             id: hrVarId,
  434 |             attributeId: hrAttrId,
  435 |             variableName: name('HR Var edited'),
  436 |           },
  437 |           'hr-var-update',
  438 |         );
  439 |         expect.soft(statusOf(hrVarUpd), 'HR tier variable updated').toMatch(/success/i);
  440 |       }
  441 | 
  442 |       // ---- Employee Data (side-effect-free Mongo record) -------------------------------------
  443 |       const emp = await call(
  444 |         endpoints,
  445 |         'admin-employee-save',
  446 |         {
  447 |           personalInformationObj: {
  448 |             firstName: 'QA',
  449 |             lastName: `Employee ${stamp}`,
  450 |             disability: false,
  451 |           },
  452 |           // FINDING: without `employmentObj` the backend NPEs (HTTP 500,
  453 |           // "getEmploymentObj() is null") instead of a 400 — a missing required field returned as a
  454 |           // server error. Sent so the lifecycle proceeds; the 500-on-missing-field is worth a ticket.
  455 |           employmentObj: {},
  456 |         },
  457 |         'employee-save',
  458 |       );
  459 |       empId = createdId(emp);
  460 |       expect.soft(statusOf(emp), 'employee saved').toMatch(/success/i);
```