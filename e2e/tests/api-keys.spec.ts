import { expect, test, type Page } from '@playwright/test';

/**
 * API keys are created and revoked in the browser but used by servers, so this checks
 * both halves: the key the page shows once really authenticates, and revoking it really
 * locks it out.
 */

async function signInAsDemo(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Use the demo account' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

/**
 * An empty batch gets past authentication and then fails validation, so it tells a valid
 * key (422) from a rejected one (401) without reporting a run into the dev database.
 */
async function probe(page: Page, key: string) {
  const response = await page.request.post('/api/ingest/events', {
    headers: { authorization: `Bearer ${key}` },
    data: { events: [] },
  });
  return response.status();
}

test('a created key authenticates until it is revoked', async ({ page }) => {
  await signInAsDemo(page);

  await page.getByRole('button', { name: /demo/i }).click();
  await page.getByRole('menuitem', { name: 'API keys' }).click();
  await expect(page.getByRole('heading', { name: 'API keys' })).toBeVisible();

  const name = `e2e key ${Date.now()}`;
  await page.getByRole('button', { name: /^(New key|Create a key)$/ }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create key' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Copy your new key')).toBeVisible();
  const key = (await dialog.locator('pre').first().textContent())?.trim() ?? '';
  expect(key).toMatch(/^flow_[A-Za-z0-9_-]{20,}$/);

  // The one-time screen must survive a stray click outside it.
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();

  const row = page.getByRole('list', { name: 'API keys' }).getByRole('listitem').filter({ hasText: name });
  await expect(row).toContainText(key.slice(0, 11));
  await expect(row).toContainText('never used');
  expect(await probe(page, key)).toBe(422);

  await row.getByRole('button', { name: `Revoke ${name}` }).click();
  await page.getByRole('button', { name: 'Revoke key' }).click();
  await expect(row).toBeHidden();
  expect(await probe(page, key)).toBe(401);
});
