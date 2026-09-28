import { expect, test, type Page } from '@playwright/test';

/**
 * The full journey a new user takes: sign up, build a graph, run it, and read the
 * result. Each assertion targets something a user can actually see.
 */

const PASSWORD = 'correct-horse-battery';

async function signUp(page: Page): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`;

  await page.goto('/register');
  await page.getByLabel('Name').fill('E2E User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  return email;
}

/** Matches one canvas node by its exact label -- `:has-text` would match substrings. */
function node(page: Page, label: string) {
  return page.locator(`.react-flow__node:has([data-node-label="${label}"])`);
}

/** Drags from one node's source handle to another node's target handle. */
async function connect(page: Page, fromLabel: string, toLabel: string) {
  const source = node(page, fromLabel).locator('.react-flow__handle-right');
  const target = node(page, toLabel).locator('.react-flow__handle-left');

  await source.scrollIntoViewIfNeeded();
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();

  const from = await source.boundingBox();
  if (!from) throw new Error(`No source handle for ${fromLabel}`);

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // React Flow only starts a connection after the pointer actually moves.
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 6, { steps: 4 });

  const to = await target.boundingBox();
  if (!to) throw new Error(`No target handle for ${toLabel}`);

  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  await page.mouse.up();
}

test('sign up, build a workflow, run it, and inspect the execution', async ({ page }) => {
  await signUp(page);

  // A brand new account has nothing, and says so.
  await expect(page.getByText('No workflows yet')).toBeVisible();

  await page.getByRole('link', { name: 'Create your first workflow' }).click();
  await page.getByLabel('Name').fill('Checkout Flow');
  await page.getByLabel('Description').fill('Created by the end-to-end test');
  await page.getByRole('button', { name: 'Create workflow' }).click();

  // The editor opens on the new workflow, pre-seeded with a trigger.
  await expect(page.getByLabel('Workflow name')).toHaveValue('Checkout Flow');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);

  // Add an action and wire the trigger into it.
  await page.getByRole('button', { name: /^Action/ }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);

  // The new node is selected, so its config panel is open.
  await page.getByLabel('Label').fill('Charge Card');
  await page.getByLabel('Operation').fill('chargeCard');
  await page.getByLabel('Minimum duration').fill('120');
  await page.getByLabel('Maximum duration').fill('260');
  await page.keyboard.press('Escape');

  await connect(page, 'Start', 'Charge Card');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  await page.getByRole('button', { name: 'Save' }).click();
  // Save going disabled is the editor confirming the canvas matches what is stored.
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(page.getByText('Unsaved')).toBeHidden();

  // Run it, and land on the live execution view.
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page).toHaveURL(/\/runs\//);

  // The run reaches a terminal state and every node ends up successful.
  await expect(page.getByText('Success', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-status="success"]')).toHaveCount(2, { timeout: 30_000 });

  // The timeline lists both nodes with real durations.
  await expect(page.getByRole('button', { name: /Charge Card/ }).first()).toBeVisible();

  // Clicking a node opens the inspector with its recorded payloads.
  await node(page, 'Charge Card').click();
  const inspector = page.getByRole('complementary').filter({ hasText: 'CHARGE CARD' });
  await expect(inspector.getByText('Input')).toBeVisible();
  await expect(inspector.getByText('Output')).toBeVisible();
  await expect(inspector.getByText('transactionId')).toBeVisible();

  // The event log shows the engine's actual sequence.
  await page.getByRole('tab', { name: /Events/ }).click();
  await expect(page.getByText('workflow.started')).toBeVisible();
  await expect(page.getByText('workflow.completed')).toBeVisible();

  // And the run is now in history.
  await page.getByRole('link', { name: 'Executions', exact: true }).click();
  await expect(page.getByText('Checkout Flow').first()).toBeVisible();
});

test('a failing node exhausts its retries and stops the nodes downstream', async ({ page }) => {
  await signUp(page);

  await page.goto('/app/workflows/new');
  await page.getByLabel('Name').fill('Failing Pipeline');
  await page.getByRole('button', { name: 'Create workflow' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);

  // A node that always fails, with one retry.
  await page.getByRole('button', { name: /^Action/ }).click();
  await page.getByLabel('Label').fill('Send Email');
  await page.getByLabel('Minimum duration').fill('40');
  await page.getByLabel('Maximum duration').fill('60');
  // End sets the slider to its maximum: this node fails on every attempt.
  await page.getByRole('slider', { name: 'Failure probability' }).press('End');
  await page.getByRole('slider', { name: 'Retries' }).press('ArrowRight');
  await page.keyboard.press('Escape');

  // A node after it, which must never run.
  await page.getByRole('button', { name: /^End/ }).click();
  await page.keyboard.press('Escape');

  await connect(page, 'Start', 'Send Email');
  await connect(page, 'Send Email', 'End');
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page).toHaveURL(/\/runs\//);

  await expect(page.locator('[data-status="failed"]')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('[data-status="skipped"]')).toHaveCount(1, { timeout: 30_000 });

  // The inspector explains the failure and shows both attempts.
  await node(page, 'Send Email').click();
  const inspector = page.getByRole('complementary').filter({ hasText: 'SEND EMAIL' });
  await expect(inspector.getByText('Retries exhausted')).toBeVisible();
  await expect(inspector.getByText('Attempt 1')).toBeVisible();
  await expect(inspector.getByText('Attempt 2')).toBeVisible();

  // And the run is flagged as anomalous.
  await page.getByRole('tab', { name: /Anomalies/ }).click();
  await expect(page.getByText(/exhausted all 2 attempts/)).toBeVisible();
});
