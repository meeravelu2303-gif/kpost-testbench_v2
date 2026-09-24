import type { Page } from '@playwright/test';

/**
 * The shared shape between `accessibility-axe.spec.ts` (which writes it) and the Bugzilla reporter's
 * accessibility candidate builder (which reads it back). Keeping the attachment name and type in one
 * place means the two can never drift silently — a rename here breaks the build, not a silent
 * "0 accessibility candidates" at filing time.
 */

/** A single axe-core rule violation, trimmed to what a ticket and the filer both need. */
export interface AxeViolationEvidence {
  /** The axe rule id, e.g. `color-contrast`, `aria-required-attr` — this is what tickets group by. */
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  /** axe's one-line description of the rule. */
  help: string;
  helpUrl: string;
  /** WCAG success-criterion tags, e.g. `wcag2aa`, `wcag143`. */
  tags: string[];
  /** How many elements on THIS screen failed the rule. */
  nodeCount: number;
  /** A few example CSS selectors, for the developer to find the failing element(s). */
  targets: string[];
}

/** One screen's filtered axe report — only the tiers the spec soft-asserts on (critical/serious). */
export interface AxeScreenResult {
  screen: string;
  route: string;
  violations: AxeViolationEvidence[];
}

/** The Playwright attachment name the spec writes and the reporter reads back. */
export const AXE_JSON_ATTACHMENT = 'axe-violations-json';

/**
 * Paints the WCAG violations found on this screen as readable text ONTO the page itself, the same
 * technique used for JS-crash proof (`renderCrashOverlay`) and for the same reason: a WCAG violation
 * (missing alt text, low contrast, no accessible name) is a static DOM/attribute property — nothing
 * visibly happens, so a plain screenshot or video of the page shows nothing wrong. This overlay is
 * what turns the screenshot AND the recorded video into real evidence: the video now ends on a
 * readable violation report instead of an unremarkable, unchanging page.
 */
export async function renderAccessibilityOverlay(
  page: Page,
  screen: string,
  violations: readonly AxeViolationEvidence[],
): Promise<void> {
  await page
    .evaluate(
      ({ screen: screenName, violations: v }) => {
        const esc = (s: string): string =>
          s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
        const old = document.getElementById('__kp_a11y_overlay');
        if (old) old.remove();
        const el = document.createElement('div');
        el.id = '__kp_a11y_overlay';
        el.setAttribute(
          'style',
          'position:fixed;inset:0;z-index:2147483647;background:rgba(10,8,20,.96);' +
            'color:#f4f4f5;font-family:Consolas,Menlo,monospace;font-size:14px;line-height:1.55;' +
            'padding:28px 32px;overflow:auto;',
        );
        const color = (impact: string): string => (impact === 'critical' ? '#ff5c5c' : '#e0a94a');
        const rows = v
          .map(
            (x) =>
              `<div style="margin-top:16px;border-left:4px solid ${color(x.impact)};padding:10px 14px;background:#000;border-radius:4px">` +
              `<div style="color:${color(x.impact)};font-weight:700;text-transform:uppercase;font-size:12px;letter-spacing:.05em">` +
              `${esc(x.impact)} — ${esc(x.id)}</div>` +
              `<div style="margin-top:4px">${esc(x.help)}</div>` +
              `<div style="margin-top:6px;color:#a1a1aa;font-size:12.5px">Affects ${x.nodeCount} element(s), e.g. ` +
              `<code style="background:#1a1a1a;padding:1px 5px;border-radius:3px">${esc(x.targets[0] ?? '(unknown)')}</code></div>` +
              `<div style="margin-top:4px"><a href="${esc(x.helpUrl)}" style="color:#7dd3fc">${esc(x.helpUrl)}</a></div>` +
              `</div>`,
          )
          .join('');
        el.innerHTML =
          '<div style="max-width:960px;margin:0 auto">' +
          `<div style="font-size:24px;font-weight:800;color:#ffd166">&#9888;&#65039; WCAG VIOLATIONS ON THE ${esc(
            screenName.toUpperCase(),
          )} SCREEN</div>` +
          '<div style="color:#c8cad0;margin-top:8px">This screen looks normal but fails the checks ' +
          'below — an accessibility violation is a property of the markup, not something that visibly ' +
          'changes, so a plain screenshot or video would show nothing wrong. This overlay is the proof.</div>' +
          rows +
          '<div style="margin-top:20px;color:#a1a1aa;font-size:12.5px">Reproduce: open this screen ' +
          'with a screen reader or run axe-core / Lighthouse accessibility audit on it.</div>' +
          '</div>';
        document.body.appendChild(el);
      },
      { screen, violations },
    )
    .catch(() => undefined);
}
