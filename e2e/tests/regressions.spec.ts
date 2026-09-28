import { expect, test, type Page } from '@playwright/test';

/**
 * Regressions for defects found during manual browser testing. Each one shipped at some
 * point, so each gets a test that would have caught it.
 */

const DEMO = { email: 'demo@flow.dev', password: 'flowdemo123' };

async function signInAsDemo(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Use the demo account' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

const node = (page: Page, label: string) =>
  page.locator(`.react-flow__node:has([data-node-label="${label}"])`);

test('sign-in returns to the page that required auth', async ({ page }) => {
  // Reach a protected deep link while signed out.
  await page.goto('/app/executions');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole('button', { name: 'Use the demo account' }).click();

  // It must land back on /app/executions, not the dashboard.
  await expect(page).toHaveURL(/\/app\/executions$/);
  await expect(page.getByRole('heading', { name: 'Executions' })).toBeVisible();
});

test('a revoked session redirects instead of showing an auth error', async ({ page, context }) => {
  await signInAsDemo(page);
  await page.goto('/app/executions');
  await expect(page.locator('ul li a').first()).toBeVisible();

  // Sign out from a second tab, exactly as the manual test did.
  const other = await context.newPage();
  await other.goto('/app');
  await other.getByRole('button', { name: /Demo User/ }).click();
  await other.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(other).toHaveURL(/\/login$/);
  await other.close();

  // The first tab's next request 401s; it must bounce to /login rather than render an
  // "Authentication required" error under a stale username.
  await page.reload();
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
  await expect(page.getByText('Authentication required')).toBeHidden();
});

test('the editor refuses to connect a node to itself', async ({ page }) => {
  await signInAsDemo(page);
  await page.goto('/app/workflows/new');
  await page.getByLabel('Name').fill(`Self loop ${Date.now()}`);
  await page.getByRole('button', { name: 'Create workflow' }).click();
  await expect(node(page, 'Start')).toBeVisible();

  // A trigger has no input handle, so use an Action -- which is what a user would hit.
  await page.getByRole('button', { name: /^Action/ }).click();
  await expect(node(page, 'Action')).toBeVisible();

  const source = node(page, 'Action').locator('.react-flow__handle-right');
  const target = node(page, 'Action').locator('.react-flow__handle-left');
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 6, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();

  // A self-loop can never satisfy its own join, so it must not be creatable at all.
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
});

test('leaving the editor with unsaved changes asks first', async ({ page }) => {
  await signInAsDemo(page);
  await page.goto('/app/workflows/new');
  await page.getByLabel('Name').fill(`Guarded ${Date.now()}`);
  await page.getByRole('button', { name: 'Create workflow' }).click();
  await expect(node(page, 'Start')).toBeVisible();

  await page.getByRole('button', { name: /^Action/ }).click();
  await expect(page.getByText('Unsaved')).toBeVisible();

  let asked = false;
  page.on('dialog', async (dialog) => {
    asked = true;
    expect(dialog.message()).toContain('unsaved changes');
    await dialog.dismiss();            // "stay on the page"
  });

  await page.getByRole('link', { name: 'Dashboard' }).click();
  await page.waitForTimeout(500);

  expect(asked).toBe(true);
  await expect(page).toHaveURL(/\/app\/workflows\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Unsaved')).toBeVisible();
});

test('Delete removes the selected node, not just Backspace', async ({ page }) => {
  await signInAsDemo(page);
  await page.goto('/app/workflows/new');
  await page.getByLabel('Name').fill(`Delete key ${Date.now()}`);
  await page.getByRole('button', { name: 'Create workflow' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);

  await page.getByRole('button', { name: /^Action/ }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);

  await node(page, 'Action').click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
});

test('Run again shows the new run, not the previous one', async ({ page }) => {
  await signInAsDemo(page);
  await page.goto('/app/workflows');
  await page.locator('li:has-text("Agent Workflow") button:has-text("Run")').click();
  await expect(page).toHaveURL(/\/runs\//);

  const streams: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/stream')) streams.push(r.url());
  });

  const settle = async () => {
    await expect(page.getByText(/Success|Failed/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-status="running"], [data-status="retrying"]')).toHaveCount(0);
  };
  await settle();

  const firstId = page.url().split('/').pop();

  // "Run again" keeps the same route, so the page is not remounted -- the hook has to
  // clear the previous run's state and replay position itself.
  await page.getByRole('button', { name: 'Run again' }).click();
  await expect(page).not.toHaveURL(new RegExp(`${firstId}$`));
  await settle();

  const secondId = page.url().split('/').pop()!;

  // The new run must be streamed from the beginning, not from the old run's last seq.
  expect(streams.some((u) => u.includes(secondId))).toBe(true);
  for (const url of streams) {
    expect(new URL(url).searchParams.get('since')).toBe('0');
  }

  // And what is on screen must be this run, not the one before it.
  const durationText = await page.locator('header').nth(1).innerText();
  const shown = durationText.match(/(\d+(?:\.\d+)?)(ms|s)\b/);
  expect(shown).not.toBeNull();
  const shownMs = shown![2] === 's' ? parseFloat(shown![1]) * 1000 : parseFloat(shown![1]);

  const response = await page.request.get(`/api/executions/${secondId}`);
  const serverMs = (await response.json()).execution.durationMs;
  expect(Math.abs(shownMs - serverMs)).toBeLessThan(400);
});

test('canvas controls use the dark theme', async ({ page }) => {
  await signInAsDemo(page);
  await page.goto('/app/workflows');
  await page.getByText('Signup Pipeline').first().click();
  await expect(page.locator('.react-flow__controls-button').first()).toBeVisible();

  // React Flow's stylesheet must load before the dark overrides, not after.
  const background = await page
    .locator('.react-flow__controls-button')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);

  const [r, g, b] = background.match(/\d+/g)!.map(Number) as [number, number, number];
  expect(r + g + b).toBeLessThan(200); // dark surface, not near-white
});
