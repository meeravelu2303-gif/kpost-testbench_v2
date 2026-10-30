import type { Locator } from '@playwright/test';

/** The checkbox in `scope` whose row text matches `label` (each checkbox paired with its nearest text). */
export async function checkboxFor(scope: Locator, label: RegExp): Promise<Locator | null> {
  const boxes = scope.getByRole('checkbox');
  await boxes
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => undefined);
  const labels = await boxes.evaluateAll((els) =>
    els.map((el) => {
      let node: HTMLElement | null = el.parentElement;
      while (node && (node.innerText ?? '').trim().length < 3) node = node.parentElement;
      return (node?.innerText ?? '').replace(/\s+/g, ' ').trim();
    }),
  );
  const at = labels.findIndex((l) => label.test(l));
  return at >= 0 ? boxes.nth(at) : null;
}
