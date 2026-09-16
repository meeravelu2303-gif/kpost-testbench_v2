// Generates docs/COMPONENT-ROUTING.md, so the "conditionals" flagged here are table formatting.
/* eslint-disable playwright/no-conditional-in-test */
import fs from 'node:fs';
import path from 'node:path';
import { apiRegistry } from '@api/definitions/index';
import type { EndpointDefinition } from '@api/registry/endpoint-definition';
import { ROOT_DIR } from '@config/constants';
import { KNOWN_COMPONENTS, componentFor, suiteFor, type SuiteId } from '@config/ownership.config';
import { expect, test } from '@fixtures';

/**
 * Component routing — the answer to "does every endpoint file under the RIGHT Bugzilla component?".
 *
 * It resolves `componentFor` for every registered endpoint and (1) asserts the result is a **real**
 * component of that endpoint's product — the exact set that exists live in the instance
 * (`KNOWN_COMPONENTS`, verified against Bugzilla on 2026-09-14) — so a typo or a renamed component can
 * never silently send tickets to a component that does not exist; and (2) writes
 * `docs/COMPONENT-ROUTING.md`, a component → endpoints map, so the routing is auditable at a glance.
 *
 * The catch-all fallback components (`kpost-webservice-application`, `kmail-application`) are allowed
 * but surfaced: a built module's endpoints landing there is a routing gap to fix, not an error here.
 */

const FALLBACKS = new Set(['kpost-webservice-application', 'kmail-application', 'General']);

test.describe('component routing @framework', () => {
  test('every endpoint routes to a real component, and the map is written', () => {
    const endpoints = apiRegistry.all().filter((d: EndpointDefinition) => !d.mockFixture);

    // suite → component → endpoint ids
    const bySuite = new Map<SuiteId, Map<string, string[]>>();
    const notReal: string[] = [];
    const onCatchAll: string[] = [];

    for (const d of endpoints) {
      const suite = suiteFor(d.suite);
      const sid = suite.id;
      const tags = d.tags ?? [];
      const component = componentFor(suite, tags);
      const known = KNOWN_COMPONENTS[sid];

      // Every resolved component must exist in the product (or be that product's own fallback).
      if (known && !known.has(component)) {
        notReal.push(
          `${sid} · ${d.id} → "${component}" (not a component of ${suite.bugzilla.product})`,
        );
      }
      if (FALLBACKS.has(component)) onCatchAll.push(`${sid} · ${d.id} (${tags.join(',')})`);

      const perSuite = bySuite.get(sid) ?? new Map<string, string[]>();
      const list = perSuite.get(component) ?? [];
      list.push(d.id);
      perSuite.set(component, list);
      bySuite.set(sid, perSuite);
    }

    const lines: string[] = [
      '# Component routing — every endpoint → its Bugzilla component',
      '',
      '**GENERATED — do not edit.** Written by `tests/framework/component-routing.spec.ts`',
      '(`npm run test:framework`). It resolves `componentFor` for every registered endpoint and checks',
      'each target exists in the live product, so tickets can never route to a non-existent component.',
      '',
    ];
    for (const [suiteId, perSuite] of [...bySuite.entries()].sort()) {
      const suite = suiteFor(suiteId);
      const total = [...perSuite.values()].reduce((n, l) => n + l.length, 0);
      lines.push(`## ${suite.bugzilla.product} (${total} endpoints)`, '');
      lines.push('| Component | Endpoints |', '| --------- | --------: |');
      for (const [component, ids] of [...perSuite.entries()].sort(
        (a, b) => b[1].length - a[1].length,
      )) {
        lines.push(`| ${component} | ${ids.length} |`);
      }
      lines.push('');
      // Per-endpoint detail, so routing CORRECTNESS (not just existence) is auditable at a glance.
      lines.push(`### ${suite.bugzilla.product} — endpoint → component`, '');
      for (const [component, ids] of [...perSuite.entries()].sort()) {
        lines.push(`**${component}**`, '');
        for (const id of [...ids].sort()) lines.push(`- \`${id}\``);
        lines.push('');
      }
    }
    if (onCatchAll.length) {
      lines.push(
        '## On the catch-all component (review — a built module here is a routing gap)',
        '',
        ...onCatchAll.map((e) => `- ${e}`),
        '',
      );
    }

    const outPath = path.join(ROOT_DIR, 'docs', 'COMPONENT-ROUTING.md');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${lines.join('\n')}\n`);

    // The hard guarantee: nothing routes to a component that does not exist in its product.
    expect(notReal, 'endpoints routed to a non-existent component').toEqual([]);
  });
});
