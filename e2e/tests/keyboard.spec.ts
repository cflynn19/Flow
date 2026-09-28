import { expect, test, type Page } from '@playwright/test';

/**
 * Keyboard-driven navigation. A debugger gets used with the hands on the keyboard, so
 * these paths matter as much as the mouse ones.
 */

const DEMO = { email: 'demo@flow.dev', password: 'flowdemo123' };

async function signInAsDemo(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Use the demo account' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

const paletteInput = (page: Page) => page.getByPlaceholder('Search workflows and executions…');

test.describe('command palette', () => {
  test('opens with the shortcut, filters, and navigates', async ({ page }) => {
    await signInAsDemo(page);

    await page.keyboard.press('ControlOrMeta+k');
    await expect(paletteInput(page)).toBeVisible();

    await paletteInput(page).fill('payment');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/app\/workflows\/[0-9a-f-]{36}$/);
    await expect(page.getByLabel('Workflow name')).toHaveValue('Payment Workflow');
  });

  test('closes on Escape', async ({ page }) => {
    await signInAsDemo(page);

    await page.keyboard.press('ControlOrMeta+k');
    await expect(paletteInput(page)).toBeVisible();

    // The palette supplies its own overlay, so it has to handle Escape itself.
    await page.keyboard.press('Escape');
    await expect(paletteInput(page)).toBeHidden();
  });

  test('toggles closed with the same shortcut', async ({ page }) => {
    await signInAsDemo(page);

    await page.keyboard.press('ControlOrMeta+k');
    await expect(paletteInput(page)).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(paletteInput(page)).toBeHidden();
  });
});

test.describe('execution view', () => {
  test('Escape closes the node inspector', async ({ page }) => {
    await signInAsDemo(page);

    await page.getByRole('link', { name: 'Executions', exact: true }).click();
    await page.locator('ul li a').first().click();
    await expect(page).toHaveURL(/\/runs\//);

    await page.locator('.react-flow__node').first().click();
    const inspector = page.getByRole('complementary');
    await expect(inspector).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(inspector).toBeHidden();
  });
});

test.describe('history on a narrow viewport', () => {
  test('keeps the workflow name readable and does not scroll sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAsDemo(page);
    await page.goto('/app/executions');

    const firstRow = page.locator('ul li a').first();
    await expect(firstRow).toBeVisible();

    // A six-column grid at this width squeezes the name to zero; the layout must stack.
    const nameBox = await firstRow.locator('span.min-w-0 span span').first().boundingBox();
    expect(nameBox?.width ?? 0).toBeGreaterThan(60);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
