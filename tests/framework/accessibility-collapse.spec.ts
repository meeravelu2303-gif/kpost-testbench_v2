import {
  accessibilityCandidatesFromScreens,
  type AccessibilityScreenInput,
} from '../../src/bug-tracker/bug-candidate';
import { readBugzillaConfig } from '../../src/config/bugzilla.config';
import { proofFrom } from '../../src/reporting/bugzilla-reporter';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Regression guard for "one WCAG rule across many screens is one ticket".
 *
 * axe-core reports the SAME rule on every screen that reuses the offending component (a shared header
 * failing color-contrast shows up on every page). Filing per screen would flood the queue with near-
 * duplicates of the same root cause — the UI-side analogue of the platform-wide API collapse. These
 * tests lock in: one ticket per rule id, the affected-screen list, severity escalation to the worst
 * tier observed, and a stable fingerprint independent of screen order.
 */
const config = readBugzillaConfig();

const screen = (
  name: string,
  route: string,
  violations: AccessibilityScreenInput['violations'],
): AccessibilityScreenInput => ({ screen: name, route, violations });

const violation = (
  id: string,
  impact: 'critical' | 'serious',
  nodeCount = 1,
): AccessibilityScreenInput['violations'][number] => ({
  id,
  impact,
  help: `${id} help text`,
  helpUrl: `https://dequeuniversity.com/rules/axe/4/${id}`,
  tags: ['wcag2aa'],
  nodeCount,
  targets: ['.some-selector'],
});

test.describe('accessibility rule collapse — one WCAG rule is one ticket @framework', () => {
  test('the same rule on 2 screens collapses to ONE candidate listing both screens', () => {
    const screens = [
      screen('Profile', '/userprofile', [violation('color-contrast', 'serious', 3)]),
      screen('Settings', '/settings', [violation('color-contrast', 'serious', 2)]),
    ];
    const candidates = accessibilityCandidatesFromScreens(screens, config);
    expect(candidates, 'one rule across two screens is one ticket').toHaveLength(1);
    expect(candidates[0]?.title).toContain('color-contrast');
    expect(candidates[0]?.title).toContain('2 screens');
    expect(candidates[0]?.actual).toContain('Profile');
    expect(candidates[0]?.actual).toContain('Settings');
    // Total elements across both screens (3 + 2), not just one screen's count.
    expect(candidates[0]?.occurrences).toBe(5);
  });

  test('the fingerprint is stable regardless of which screen is listed first', () => {
    const order1 = [
      screen('Profile', '/userprofile', [violation('aria-required-attr', 'critical')]),
      screen('Contacts', '/katchup', [violation('aria-required-attr', 'critical')]),
    ];
    const order2 = [
      screen('Contacts', '/katchup', [violation('aria-required-attr', 'critical')]),
      screen('Profile', '/userprofile', [violation('aria-required-attr', 'critical')]),
    ];
    const idsA = accessibilityCandidatesFromScreens(order1, config).map((c) => c.id);
    const idsB = accessibilityCandidatesFromScreens(order2, config).map((c) => c.id);
    expect(idsA, 'screen order must not change the ticket id').toEqual(idsB);
  });

  test('two distinct rules on the same screen file as two separate tickets', () => {
    const screens = [
      screen('Profile', '/userprofile', [
        violation('color-contrast', 'serious'),
        violation('image-alt', 'critical'),
      ]),
    ];
    const candidates = accessibilityCandidatesFromScreens(screens, config);
    expect(candidates, 'distinct rules never merge').toHaveLength(2);
    const ids = new Set(candidates.map((c) => c.classification));
    expect(ids).toEqual(new Set(['accessibility.color-contrast', 'accessibility.image-alt']));
  });

  test('a rule that is critical on one screen and serious on another files as CRITICAL', () => {
    const screens = [
      screen('Profile', '/userprofile', [violation('label', 'serious')]),
      screen('Settings', '/settings', [violation('label', 'critical')]),
    ];
    const candidates = accessibilityCandidatesFromScreens(screens, config);
    expect(candidates[0]?.severity, 'the worse tier observed wins').toBe('CRITICAL');
  });

  test('moderate/minor violations never become candidates (only critical/serious file)', () => {
    const moderate: AccessibilityScreenInput['violations'][number] = {
      id: 'region',
      impact: 'moderate',
      help: 'region help text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4/region',
      tags: ['wcag2aa'],
      nodeCount: 1,
      targets: ['.some-selector'],
    };
    const screens = [screen('Profile', '/userprofile', [moderate])];
    const candidates = accessibilityCandidatesFromScreens(screens, config);
    expect(candidates, 'moderate is below the filing bar').toHaveLength(0);
  });

  test('each candidate is a UI-sourced ticket routed to the KPost UI suite', () => {
    const screens = [screen('Profile', '/userprofile', [violation('link-name', 'serious')])];
    const [candidate] = accessibilityCandidatesFromScreens(screens, config);
    expect(candidate?.source).toBe('ui');
    expect(candidate?.suiteId).toBe('kpost-ui');
    expect(candidate?.category).toBe('Functional');
  });

  test("a rule found on 2 screens carries BOTH screens' proof — the actual page, not just JSON", () => {
    const withProof = (name: string, route: string, id: string): AccessibilityScreenInput => ({
      screen: name,
      route,
      violations: [violation(id, 'serious')],
      proof: [
        { path: `/tmp/${name}.png`, contentType: 'image/png', label: `Screenshot (${name})` },
        { path: `/tmp/${name}.webm`, contentType: 'video/webm', label: `Video (${name})` },
      ],
    });
    const screens = [
      withProof('Home', '/home', 'color-contrast'),
      withProof('Settings', '/settings', 'color-contrast'),
    ];
    const [candidate] = accessibilityCandidatesFromScreens(screens, config);
    expect(candidate?.proof, 'proof from every affected screen is attached').toHaveLength(4);
    const labels = candidate?.proof?.map((p) => p.label) ?? [];
    expect(labels).toContain('Screenshot (Home)');
    expect(labels).toContain('Screenshot (Settings)');
    expect(labels).toContain('Video (Home)');
    expect(labels).toContain('Video (Settings)');
  });

  test('a screen with no proof does not break a candidate that has none to attach', () => {
    const screens = [screen('Profile', '/userprofile', [violation('label', 'serious')])];
    const [candidate] = accessibilityCandidatesFromScreens(screens, config);
    expect(candidate?.proof).toEqual([]);
  });

  test('proofFrom with includeVideo:false attaches the screenshot but never the video', () => {
    // A WCAG violation is a static property (missing alt text, low contrast) — the first frame and
    // the last frame of a recording look identical, so a video is pure wasted storage for it.
    const attachments = [
      { name: 'screenshot', path: '/tmp/shot.png', contentType: 'image/png' },
      { name: 'video', path: '/tmp/clip.webm', contentType: 'video/webm' },
    ];
    const proof = proofFrom(attachments, 'Home', { includeVideo: false });
    expect(proof).toHaveLength(1);
    expect(proof[0]?.label).toBe('Screenshot (Home)');
    expect(proof.some((p) => p.label.startsWith('Video'))).toBe(false);
  });

  test('proofFrom picks the LARGEST video when Playwright emits more than one under the same name', () => {
    // Reproduces the real bug: a brief secondary browser context (e.g. an auth-state check) leaves a
    // near-empty "stub" video attached under the same name as the real recording. Picking "first in
    // the array" grabbed the stub every time; picking "largest file on disk" always finds the real one.
    const dir = mkdtempSync(join(tmpdir(), 'kp-proof-test-'));
    const stubPath = join(dir, 'stub.webm');
    const realPath = join(dir, 'real.webm');
    writeFileSync(stubPath, Buffer.alloc(1965)); // the exact stub size observed live
    writeFileSync(realPath, Buffer.alloc(331_000)); // a real multi-second recording

    // The stub listed FIRST, as Playwright's own attachments array did in the field.
    const attachments = [
      { name: 'video', path: stubPath, contentType: 'video/webm' },
      { name: 'video', path: realPath, contentType: 'video/webm' },
    ];
    const proof = proofFrom(attachments, 'Home');
    const video = proof.find((p) => p.label === 'Video (Home)');
    expect(video?.path, 'the larger, real recording is chosen over the tiny stub').toBe(realPath);
  });

  test('proofFrom still attaches video by default for callers that need it (e.g. crash sweeps)', () => {
    const attachments = [
      { name: 'screenshot', path: '/tmp/shot.png', contentType: 'image/png' },
      { name: 'video', path: '/tmp/clip.webm', contentType: 'video/webm' },
    ];
    const proof = proofFrom(attachments, 'chromium');
    expect(proof).toHaveLength(2);
    expect(proof.some((p) => p.label === 'Video (chromium)')).toBe(true);
  });

  test('a repeated retry of the same screen never duplicates its proof by label', () => {
    // Simulates a flaky retry that recaptured "Home" twice — same label, different underlying file.
    const attempt1: AccessibilityScreenInput = {
      screen: 'Home',
      route: '/home',
      violations: [violation('image-alt', 'critical')],
      proof: [{ path: '/tmp/attempt1.png', contentType: 'image/png', label: 'Screenshot (Home)' }],
    };
    const attempt2: AccessibilityScreenInput = {
      screen: 'Home',
      route: '/home',
      violations: [violation('image-alt', 'critical')],
      proof: [{ path: '/tmp/attempt2.png', contentType: 'image/png', label: 'Screenshot (Home)' }],
    };
    const [candidate] = accessibilityCandidatesFromScreens([attempt1, attempt2], config);
    expect(candidate?.proof, 'the same label is never attached twice').toHaveLength(1);
  });
});
