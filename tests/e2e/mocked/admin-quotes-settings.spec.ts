import { expect, test, type Page } from '@playwright/test';
import { USERS, profile, uiLogin } from '../helpers/mockBackend';
import { ADDRESS_ID, buyerWorld, QUOTE_ID } from './fixtures';

const SUP_A = '50000000-0000-4000-8000-00000000000a';
const SUP_B = '50000000-0000-4000-8000-00000000000b';

function adminWorld() {
  const m = buyerWorld();
  m.addUser({ id: USERS.admin.id, email: USERS.admin.email, password: USERS.admin.password, profile: profile(USERS.admin.id, 'admin') });
  m.table('profiles', [
    ...(m.tables.profiles ?? []),
    { id: SUP_A, full_name: 'Sipho Farms', business_name: 'Sipho Poultry', role: 'supplier' },
    { id: SUP_B, full_name: 'Naledi Farms', business_name: null, role: 'supplier' },
  ]);
  m.table('admin_quotes', [{
    id: QUOTE_ID, buyer_id: USERS.buyer.id, address_id: ADDRESS_ID, kind: 'requested', status: 'open', bird_type: 'broiler',
    weight_band: '2_to_2_5kg', quantity: 400, total_cents: null, expires_at: null, created_at: new Date().toISOString(),
  }]);
  m.table('addresses', [{ id: ADDRESS_ID, town: 'Soweto', province: 'GP' }]);
  m.table('driver_details', []);
  m.rpc('admin_quote_candidates', () => ({ data: [
    { supplier_id: SUP_A, eligible: true, reasons: [], price_cents: 9000, distance_km: 12.5, same_province: true, stock_available: 300, rating_avg: 4.5, rank: 1 },
    { supplier_id: SUP_B, eligible: true, reasons: [], price_cents: 7000, distance_km: 40, same_province: false, stock_available: 500, rating_avg: 4, rank: 2 },
  ] }));
  m.rpc('admin_price_quote', () => ({ data: { total_cents: 123456 } }));
  m.rpc('admin_update_settings', () => ({ data: { changed: [] } }));
  m.rpc('admin_update_area', () => ({ data: null }));
  m.table('settings', [
    { key: 'payments_mode', value: 'manual' },
    { key: 'company_profile', value: { name: "McCluckin's", address: '', email: '', phone: '', registration: '', bank_name: 'FNB', account_holder: '', account_number: '', branch_code: '', account_type: 'Cheque' } },
    { key: 'markup_pct', value: 15 }, { key: 'min_margin_cents', value: 800 }, { key: 'service_fee_pct', value: 3 },
    { key: 'delivery_base_cents', value: 15000 }, { key: 'delivery_per_km_cents', value: 800 }, { key: 'delivery_per_bird_cents', value: 100 },
    { key: 'driver_share_pct', value: 85 }, { key: 'quote_hold_minutes', value: 30 }, { key: 'rfq_min_birds', value: 300 },
    { key: 'rfq_max_km', value: 100 }, { key: 'min_order', value: 10 }, { key: 'unpaid_cancel_hours', value: 24 },
    { key: 'issue_window_hours', value: 24 }, { key: 'heat_warn_c', value: 30 }, { key: 'journey_warn_hours', value: 4 },
    { key: 'delivery_timeline', value: null },
  ]);
  m.table('areas_served', []);
  m.table('provinces', []);
  return m;
}

async function go(page: Page, path: string) {
  await uiLogin(page, USERS.admin);
  await page.goto(path);
}

test.describe('admin: quote requests', () => {
  test('a requested quote shows up, with the buyer and what they asked for', async ({ page }) => {
    await adminWorld().install(page);
    await go(page, '/admin/quotes');
    await expect(page.getByText('Thandi Buyer')).toBeVisible();
    await expect(page.getByText(/400 broiler/)).toBeVisible();
    await expect(page.getByText('Soweto, GP')).toBeVisible();
    await expect(page.getByText('Needs a price').first()).toBeVisible();
  });

  test('prices a quote by sharing the birds across suppliers; sending needs the total to match', async ({ page }) => {
    const m = adminWorld();
    await m.install(page);
    await go(page, '/admin/quotes');
    await page.getByRole('button', { name: 'Price this quote' }).click();
    await expect(page.getByText('Sipho Poultry')).toBeVisible();
    await expect(page.getByText('Naledi Farms')).toBeVisible();
    const send = page.getByRole('button', { name: 'Send price to buyer' });
    await expect(send).toBeDisabled();
    await page.getByLabel('Birds Sipho Poultry').fill('300');
    await expect(send).toBeDisabled();
    await expect(page.getByText('300 of 400 birds chosen')).toBeVisible();
    await page.getByLabel('Birds Naledi Farms').fill('100');
    await expect(send).toBeEnabled();
    await send.click();
    await expect.poll(() => m.rpcCalls.filter((c) => c.name === 'admin_price_quote').length).toBe(1);
    expect(m.rpcCalls.find((c) => c.name === 'admin_price_quote')?.args).toEqual({
      p_quote_id: QUOTE_ID,
      p_allocations: [
        { supplier_id: SUP_A, birds: 300, price_cents: 9000 },
        { supplier_id: SUP_B, birds: 100, price_cents: 7000 },
      ],
    });
  });

  test('a blocked quote says what is wrong, who to chase and gives a WhatsApp message', async ({ page }) => {
    const m = adminWorld();
    m.table('profiles', [
      ...(m.tables.profiles ?? []),
    ].map((p) => (p.id === SUP_A ? { ...p, whatsapp_phone: '082 111 2222' } : p)));
    m.rpc('admin_quote_candidates', () => ({ data: [
      { supplier_id: SUP_A, eligible: false, reasons: ['no_location', 'no_driver'], price_cents: 9000, distance_km: null, same_province: true, stock_available: 9000, rating_avg: null, rank: null },
    ] }));
    m.table('driver_details', [{
      profile_id: 'd1', paused: false, capacity_birds: null, covered: false,
      profile: { full_name: 'Test Driver', business_name: null, whatsapp_phone: null, status: 'active' },
    }]);
    await m.install(page);
    await go(page, '/admin/quotes');
    const box = page.getByTestId('quote-blockers');
    await expect(box).toContainText('This quote cannot be priced yet');
    await expect(box).toContainText('Supplier: Sipho Poultry');
    await expect(box).toContainText('No farm gate location');
    await expect(box).toContainText('Test Driver: Has not entered how many birds the vehicle carries');
    // The supplier has a number, so there is a link with the message written out; the driver has none.
    const wa = box.getByRole('link', { name: 'Message on WhatsApp' });
    await expect(wa).toHaveCount(1);
    const href = (await wa.getAttribute('href')) ?? '';
    expect(href).toContain('https://wa.me/27821112222');
    expect(decodeURIComponent(href)).toContain('Use my location');
    await expect(box).toContainText('No phone number on file');
    // Opening the price panel still lists the supplier but does not let you assign birds to it.
    await page.getByRole('button', { name: 'Price this quote' }).click();
    await expect(page.getByLabel('Birds Sipho Poultry')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Send price to buyer' })).toBeDisabled();
  });

  test('a quote that can be priced says so and shows no blockers', async ({ page }) => {
    await adminWorld().install(page);
    await go(page, '/admin/quotes');
    await expect(page.getByText('2 supplier(s) can fill this quote')).toBeVisible();
    await expect(page.getByTestId('quote-blockers')).toHaveCount(0);
  });

  test('a refusal from the database is shown and the panel stays open', async ({ page }) => {
    const m = adminWorld();
    m.rpc('admin_price_quote', () => ({ error: { message: 'quote is accepted', code: 'P0001' } }));
    await m.install(page);
    await go(page, '/admin/quotes');
    await page.getByRole('button', { name: 'Price this quote' }).click();
    await page.getByLabel('Birds Sipho Poultry').fill('400');
    await page.getByRole('button', { name: 'Send price to buyer' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /./ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send price to buyer' })).toBeEnabled();
  });

  test('a buyer cannot open the quotes page', async ({ page }) => {
    await adminWorld().install(page);
    await uiLogin(page, USERS.buyer);
    await page.goto('/admin/quotes');
    await expect(page).toHaveURL(/\/orders$/);
  });
});

test.describe('admin: settings', () => {
  test('never prints a database key name', async ({ page }) => {
    await adminWorld().install(page);
    await go(page, '/admin/settings');
    await expect(page.getByText('Markup on supplier price (%)')).toBeVisible();
    const text = await page.locator('main, body').first().innerText();
    for (const key of ['markup_pct', 'min_margin_cents', 'payments_mode', 'company_profile', 'delivery_timeline']) {
      expect(text, key).not.toContain(key);
    }
  });

  test('saves the payments mode and company details through the RPC', async ({ page }) => {
    const m = adminWorld();
    await m.install(page);
    await go(page, '/admin/settings');
    await page.getByLabel('How buyers pay').selectOption('paystack');
    await page.getByLabel('Account number').fill('62000000001');
    await page.getByRole('button', { name: 'Save payment settings' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => m.rpcCalls.filter((c) => c.name === 'admin_update_settings').length).toBe(1);
    const args = m.rpcCalls.find((c) => c.name === 'admin_update_settings')?.args as { p_changes: Record<string, unknown> };
    expect(args.p_changes.payments_mode).toBe('paystack');
    expect(args.p_changes.company_profile).toMatchObject({ name: "McCluckin's", bank_name: 'FNB', account_number: '62000000001' });
    // Nothing is written to the tables directly.
    expect(m.writes.filter((w) => w.table === 'settings' || w.table === 'audit_log')).toEqual([]);
  });

  test('shows the error when the database refuses the save', async ({ page }) => {
    const m = adminWorld();
    m.rpc('admin_update_settings', () => ({ error: { message: 'only an admin can change settings', code: '42501' } }));
    await m.install(page);
    await go(page, '/admin/settings');
    await page.getByLabel('Markup on supplier price (%)').fill('20');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /./ }).first()).toBeVisible();
    await expect(page.getByText('Saved.')).toHaveCount(0);
  });
});
