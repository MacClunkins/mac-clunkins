import { expect, test } from '@playwright/test';
import { USERS, profile, uiLogin } from '../helpers/mockBackend';
import { ORDER_ID, buyerWorld, doc, order } from './fixtures';

function adminWorld(status = 'placed', docs: Record<string, unknown>[] = []) {
  const m = buyerWorld({ orderStatus: status, docs: docs as never });
  m.addUser({ id: USERS.admin.id, email: USERS.admin.email, password: USERS.admin.password, profile: profile(USERS.admin.id, 'admin') });
  m.table('orders', [order({ status })]);
  m.rpc('admin_mark_order_paid', () => ({ data: { result: 'paid', order_id: ORDER_ID, receipt_id: 'r1' } }));
  m.rpc('match_suppliers', () => ({ data: [] }));
  return m;
}
const open = async (page: import('@playwright/test').Page) => {
  await uiLogin(page, USERS.admin);
  await page.goto(`/admin/orders/${ORDER_ID}`);
};

test.describe('admin: record a manual payment', () => {
  test('marks an unpaid order as paid with the full amount and the chosen method', async ({ page }) => {
    const m = adminWorld();
    await m.install(page);
    await open(page);
    await expect(page.getByText(/amount due/i)).toContainText('260');
    await page.getByLabel('Payment method').selectOption('cash');
    await page.getByLabel('Payment reference').fill('SLIP-9');
    await page.getByLabel('Note').fill('paid at depot');
    await page.getByRole('button', { name: 'Mark as paid' }).click();
    await expect.poll(() => m.rpcCalls.filter((c) => c.name === 'admin_mark_order_paid').length).toBe(1);
    expect(m.rpcCalls.find((c) => c.name === 'admin_mark_order_paid')?.args).toEqual({
      p_order_id: ORDER_ID, p_amount_cents: 26000, p_method: 'cash', p_reference: 'SLIP-9', p_note: 'paid at depot', p_bank_fee_cents: null,
    });
  });

  test('records the bank fee in cents and shows the proof of payment the buyer sent', async ({ page }) => {
    const m = adminWorld();
    m.table('payment_proofs', [{ id: 'pp1', order_id: ORDER_ID, file_path: 'buyer/b0/x.pdf', note: null, created_at: new Date().toISOString() }]);
    await m.install(page);
    await open(page);
    await expect(page.getByTestId('buyer-proofs')).toContainText('View');
    await page.getByLabel('Bank fee on this payment (R, optional)').fill('12.50');
    await page.getByRole('button', { name: 'Mark as paid' }).click();
    await expect.poll(() => m.rpcCalls.filter((c) => c.name === 'admin_mark_order_paid').length).toBe(1);
    expect(m.rpcCalls.find((c) => c.name === 'admin_mark_order_paid')?.args).toMatchObject({ p_bank_fee_cents: 1250 });
  });

  test('a bad bank fee is refused before anything is sent', async ({ page }) => {
    const m = adminWorld();
    await m.install(page);
    await open(page);
    await page.getByLabel('Bank fee on this payment (R, optional)').fill('twelve');
    await page.getByRole('button', { name: 'Mark as paid' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /fee in rand/i })).toBeVisible();
    expect(m.rpcCalls.filter((c) => c.name === 'admin_mark_order_paid')).toHaveLength(0);
  });

  test('a server refusal is shown and the order stays unpaid', async ({ page }) => {
    const m = adminWorld();
    m.rpc('admin_mark_order_paid', () => ({ error: { message: 'order_not_payable', code: 'P0001' } }));
    await m.install(page);
    await open(page);
    await page.getByRole('button', { name: 'Mark as paid' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /./ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark as paid' })).toBeEnabled();
  });

  test('a paid order offers no payment form and lists the documents', async ({ page }) => {
    await adminWorld('paid', [doc('invoice', 1), doc('receipt', 2)]).install(page);
    await open(page);
    await expect(page.getByRole('button', { name: 'Mark as paid' })).toHaveCount(0);
    await expect(page.getByText('RCT-2026-00002')).toBeVisible();
  });

  test('a buyer cannot reach the admin order page', async ({ page }) => {
    await adminWorld().install(page);
    await uiLogin(page, USERS.buyer);
    await page.goto(`/admin/orders/${ORDER_ID}`);
    await expect(page).toHaveURL(/\/orders$/);
  });
});
