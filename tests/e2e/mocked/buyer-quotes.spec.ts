import { expect, test } from '@playwright/test';
import { USERS, uiLogin } from '../helpers/mockBackend';
import { QUOTE_ID, buyerWorld, quote } from './fixtures';

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

test.describe('buyer: quotes on the orders page', () => {
  test('a priced quote shows with its price and leads to the review page', async ({ page }) => {
    const m = buyerWorld({ quoteOver: { kind: 'requested', expires_at: minutes(60 * 24) } });
    await m.install(page);
    await uiLogin(page, USERS.buyer);
    await page.goto('/orders');
    const section = page.getByRole('region', { name: 'Your quotes' });
    await expect(section).toBeVisible();
    await expect(section.getByTestId('quote-state')).toContainText('Price ready');
    await expect(section.getByTestId('quote-state')).toContainText('260');
    await section.getByRole('link', { name: 'View quote' }).click();
    await expect(page).toHaveURL(new RegExp(`/quotes/${QUOTE_ID}$`));
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/new/pay\\?quote=${QUOTE_ID}`));
    // Manual payments mode: no Paystack on the way.
    expect(m.fnCalls.filter((f) => f.name === 'paystack-init')).toHaveLength(0);
  });

  test('a request nobody has priced yet says so and has no link', async ({ page }) => {
    const m = buyerWorld({ quoteOver: { kind: 'requested', total_cents: null, expires_at: null } });
    await m.install(page);
    await uiLogin(page, USERS.buyer);
    await page.goto('/orders');
    const section = page.getByRole('region', { name: 'Your quotes' });
    await expect(section.getByTestId('quote-state')).toContainText(/pricing this one/i);
    await expect(section.getByRole('link', { name: 'View quote' })).toHaveCount(0);
  });

  test('an expired or accepted quote is not listed', async ({ page }) => {
    const m = buyerWorld({ quoteOver: { status: 'accepted' } });
    m.table('buyer_quotes', [quote({ status: 'accepted' }), quote({ id: 'c0000000-0000-4000-8000-000000000002', expires_at: minutes(-5) })]);
    await m.install(page);
    await uiLogin(page, USERS.buyer);
    await page.goto('/orders');
    await expect(page.getByRole('region', { name: 'Your quotes' })).toHaveCount(0);
  });
});
