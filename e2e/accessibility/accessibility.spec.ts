import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const auditedRoutes = [
  '/en',
  '/en/dashboard',
  '/en/dashboard/vaults',
  '/en/dashboard/claims',
  '/en/dashboard/streaming',
  '/en/dashboard/analytics',
  '/en/dashboard/admin',
] as const;

type AxeNode = {
  target: string[];
  failureSummary?: string;
};

type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
};

type AxeResult = {
  testEngine: { name: string; version: string };
  testEnvironment: Record<string, string>;
  testRunner: { name: string };
  timestamp: string;
  url: string;
  violations: AxeViolation[];
};

async function auditPage(page: Page): Promise<AxeResult> {
  await page.addScriptTag({ content: axeSource });

  return page.evaluate(async () => {
    const axe = (window as unknown as {
      axe: {
        run: (
          context: Document,
          options: Record<string, unknown>,
        ) => Promise<AxeResult>;
      };
    }).axe;

    return axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
      resultTypes: ['violations'],
    });
  });
}

function formatViolations(violations: AxeViolation[]): string {
  if (violations.length === 0) return 'No accessibility violations detected.';

  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `  - ${node.target.join(' ')}: ${node.failureSummary ?? 'No failure summary'}`)
        .join('\n');

      return `${violation.id} [${violation.impact ?? 'unknown'}] ${violation.help}\n${violation.helpUrl}\n${nodes}`;
    })
    .join('\n\n');
}

async function attachAxeReport(testInfo: TestInfo, route: string, result: AxeResult) {
  const slug = route === '/en' ? 'home' : route.replace(/^\/en\/?/, '').replaceAll('/', '-');

  await testInfo.attach(`${slug}-axe.json`, {
    body: Buffer.from(JSON.stringify(result, null, 2)),
    contentType: 'application/json',
  });
}

test.describe('WCAG A/AA browser audits', () => {
  for (const route of auditedRoutes) {
    test(`${route} has no detectable WCAG A/AA violations`, async ({ page }, testInfo) => {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(response?.ok(), `${route} should return a successful response`).toBeTruthy();

      await page.locator('main').first().waitFor({ state: 'visible' });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

      const result = await auditPage(page);
      await attachAxeReport(testInfo, route, result);

      expect(result.violations, formatViolations(result.violations)).toEqual([]);
    });
  }
});

test.describe('Keyboard-critical flows', () => {
  test('skip link moves focus to the main-content target', async ({ page }) => {
    await page.goto('/en', { waitUntil: 'domcontentloaded' });

    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await page.keyboard.press('Tab');

    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();

    await skipLink.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('dashboard tab order advances without trapping focus', async ({ page }) => {
    await page.goto('/en/dashboard', { waitUntil: 'domcontentloaded' });
    await page.locator('main').waitFor({ state: 'visible' });

    const focusSequence: string[] = [];

    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus')).toBeVisible();

      focusSequence.push(
        await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          if (!element) return 'none';

          const label =
            element.getAttribute('aria-label') ??
            element.getAttribute('title') ??
            element.textContent?.trim().slice(0, 80) ??
            '';

          return `${element.tagName.toLowerCase()}#${element.id}.${element.className}:${label}`;
        }),
      );
    }

    expect(new Set(focusSequence).size, focusSequence.join('\n')).toBeGreaterThanOrEqual(5);
    expect(focusSequence).not.toContain('body#.:');
  });
});
