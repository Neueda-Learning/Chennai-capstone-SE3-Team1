import { expect, test, type Locator, type Page } from '@playwright/test';

import { balance, orderHistory } from './api';

/** Reads the `₹1,234.56` a screen prints back into the number it stands for. */
function toRupees(printed: string): number {
  expect(printed, `"${printed}" is not a price`).toMatch(/[0-9]/);
  return Number(printed.replace(/[^0-9.]/g, ''));
}

/**
 * Picks the cheapest ticker that has a price, so a one-unit order fits the wallet whatever
 * the seeded instrument set looks like. Returns the ticker actually clicked, once the ticket
 * has re-priced around it.
 */
async function selectCheapestTicker(page: Page): Promise<string> {
  const tickers = page.getByTestId('ticker');
  await expect(tickers.first()).toBeVisible();

  let cheapest: { ticker: Locator; price: number } | null = null;
  for (const ticker of await tickers.all()) {
    const printed = (await ticker.locator('.ticker-price').innerText()).trim();
    if (!/[0-9]/.test(printed)) {
      continue; // "Waiting for price"
    }
    const price = toRupees(printed);
    if (cheapest === null || price < cheapest.price) {
      cheapest = { ticker, price };
    }
  }

  expect(cheapest, 'the market list had no priced ticker').not.toBeNull();
  const picked = (cheapest as { ticker: Locator; price: number }).ticker;
  const symbol = (await picked.locator('.ticker-symbol').innerText()).trim();
  await picked.click();

  // The ticket opens on the first priced ticker, so only the selection proves the click landed.
  await expect(page.getByTestId('selected-symbol')).toContainText(symbol);
  await expect(page.getByTestId('current-price')).not.toHaveText('—');
  return symbol;
}

test.describe('Order ticket', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/orders');
    await expect(page.getByTestId('ticker-list')).toBeVisible();
  });

  test('it lists the market and opens with a tradable ticker already selected', async ({ page }) => {
    await expect(page.getByTestId('quotes-failed')).toBeHidden();
    await expect(page.getByTestId('ticker-list').locator('[data-testid="ticker"]').first()).toBeVisible();

    await expect(page.getByTestId('selected-symbol')).toBeVisible();
    await expect(page.getByTestId('current-price')).not.toHaveText('—');
    await expect(page.getByTestId('place-order')).toBeEnabled();

    // Picking a different ticker re-prices the ticket.
    const selected = (await page.getByTestId('selected-symbol').innerText()).trim();
    const other = page.getByTestId('ticker').filter({
      has: page.locator('.ticker-symbol', { hasText: /^[A-Z]+$/ })
    });
    expect(await other.count(), 'the market list held no tickers').toBeGreaterThan(1);

    const symbols = (await page.locator('.ticker-symbol').allInnerTexts()).map((text) => text.trim());
    const target = symbols.find((symbol) => !selected.startsWith(symbol));
    expect(target, `the market list only held ${symbols.join(', ')}`).toBeTruthy();

    await page.getByTestId('ticker').filter({ hasText: target as string }).first().click();
    await expect(page.getByTestId('selected-symbol')).toContainText(target as string);
  });

  test('the estimate follows the quantity', async ({ page }) => {
    await selectCheapestTicker(page);
    await page.getByLabel('Quantity').fill('3');

    // Read both figures in one go, so a fresh quote landing mid-assert cannot skew the pair.
    const { unit, total } = await page.evaluate(() => {
      const text = (testId: string) =>
        document.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '';
      return { unit: text('ticket-price'), total: text('estimated-total') };
    });

    expect(toRupees(total), `${total} against a unit price of ${unit}`).toBeCloseTo(
      toRupees(unit) * 3,
      2
    );
  });

  test('a malformed quantity is refused in the form, without reaching the trading service', async ({
    page
  }) => {
    await selectCheapestTicker(page);

    const placed: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/orders')) {
        placed.push(request.url());
      }
    });

    for (const [quantity, message] of [
      ['0', 'Must be greater than zero.'],
      ['-4', 'Quantity must be a whole number of units.'],
      ['1.5', 'Quantity must be a whole number of units.']
    ] as const) {
      await page.getByLabel('Quantity').fill(quantity);
      await page.getByLabel('Quantity').blur();
      await expect(page.getByTestId('ticket-error')).toHaveText(message);
    }

    await page.getByLabel('Quantity').fill('');
    await page.getByLabel('Quantity').blur();
    await expect(page.getByTestId('ticket-error')).toHaveText('Enter how many units.');

    expect(placed).toEqual([]);
  });

  test('a buy the wallet cannot cover is stopped in the form', async ({ page }) => {
    await selectCheapestTicker(page);

    await page.getByLabel('Quantity').fill('100000');

    await expect(page.getByTestId('ticket-error')).toHaveText(
      'Not enough cash in your wallet for this order.'
    );
  });

  test('selling more units than are held is stopped in the form', async ({ page }) => {
    await selectCheapestTicker(page);
    await page.getByTestId('side-sell').click();
    await expect(page.getByTestId('units-available')).toBeVisible();

    await page.getByLabel('Quantity').fill('999999');

    await expect(page.getByTestId('ticket-error')).toHaveText(
      'You cannot sell more units than you hold.'
    );
  });

  test('a one-unit buy is accepted, reaches the blotter and is paid for out of the wallet', async ({
    page
  }) => {
    const cashBefore = (await balance(page)).cashBalance;

    const symbol = await selectCheapestTicker(page);

    await page.getByLabel('Quantity').fill('1');
    await page.getByTestId('place-order').click();

    const accepted = page.getByTestId('outcome-accepted');
    await expect(accepted).toBeVisible();
    await expect(accepted).toContainText(symbol);
    const orderId = (await accepted.innerText()).match(/ORD-[0-9a-f-]+/)?.[0];
    expect(orderId, `no order id in "${await accepted.innerText()}"`).toBeTruthy();

    // The same order, read back from the trading service...
    await expect
      .poll(async () => (await orderHistory(page)).some((order) => order.orderId === orderId), {
        timeout: 20_000
      })
      .toBeTruthy();

    // ...and paid for out of the wallet, at acceptance or once the executor filled it.
    await expect.poll(async () => (await balance(page)).cashBalance, { timeout: 30_000 }).toBeLessThan(
      cashBefore
    );
  });
});