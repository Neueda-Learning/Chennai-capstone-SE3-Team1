import { expect, test } from '@playwright/test';

import { orderHistory } from './api';

test.describe('Blotter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/blotter');
    await expect(page.getByRole('heading', { name: 'Blotter' })).toBeVisible();
  });

  test('it lists every order the trading service holds for the account', async ({ page }) => {
    const orders = await orderHistory(page);
    expect(orders.length, 'the test account has no order history to show').toBeGreaterThan(0);

    for (const order of orders.slice(0, 5)) {
      await expect(page.getByText(order.orderId).first()).toBeVisible();
    }
  });

  test('the search box narrows the list to what it is given', async ({ page }) => {
    const orders = await orderHistory(page);
    const wanted = orders[0];

    await page.getByPlaceholder('Order ID or symbol...').fill(wanted.orderId);

    await expect(page.getByText(wanted.orderId).first()).toBeVisible();
    await expect(page.getByText(orders[1].orderId)).toHaveCount(0);
  });

  test('a search nothing matches says so instead of showing every row', async ({ page }) => {
    await page.getByPlaceholder('Order ID or symbol...').fill('no-such-order-id');

    await expect(page.getByText('No orders match your filters')).toBeVisible();
  });

  test('the filters offer the status an order can actually reach', async ({ page }) => {
    const status = page.locator('.filter-section select').nth(1);

    await expect(status.locator('option')).toHaveText([
      'All ',
      'Working',
      'Filled',
      'Rejected',
      'Cancelled'
    ]);
  });

  test('an order can be opened for detail', async ({ page }) => {
    const orders = await orderHistory(page);

    await page.getByText(orders[0].orderId).first().click();
    await page.getByRole('button', { name: 'View order details' }).first().click();

    const dialog = page.locator('.modal-content');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(orders[0].orderId).first()).toBeVisible();
    await expect(dialog.getByText(orders[0].side).first()).toBeVisible();
  });
});