import { expect, test } from '@playwright/test';
import { USERS, backendWith, uiLogin } from '../helpers/mockBackend';

const at = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function world() {
  const m = backendWith('admin');
  m.table('audit_log', [
    { id: 3, actor_id: USERS.admin.id, action: 'admin.correction', entity: 'allocations', entity_id: 'a1', before: { birds_counted: 500 }, after: { birds_counted: 1000, reason: 'Crate cap entered by mistake' }, created_at: at(5) },
    { id: 2, actor_id: null, action: 'order.short_load', entity: 'orders', entity_id: 'o1', before: null, after: { ordered: 1000, collected: 500 }, created_at: at(30) },
    { id: 1, actor_id: USERS.admin.id, action: 'something.unlabelled_yet', entity: 'quotes', entity_id: 'q1', before: null, after: null, created_at: at(60) },
  ]);
  return m;
}

test.describe('admin: audit log', () => {
  test('lists what happened in plain words, who did it, and what changed', async ({ page }) => {
    await world().install(page);
    await uiLogin(page, USERS.admin);
    await page.goto('/admin/audit');
    const rows = page.getByTestId('audit-rows');
    await expect(rows).toContainText('Count corrected by admin');
    await expect(rows).toContainText('Short load recorded');
    await expect(rows).toContainText('System');
    // an action nobody wrote a label for is still readable
    await expect(rows).toContainText('Something unlabelled yet');
    await rows.getByText('Count corrected by admin').click();
    await expect(page.getByTestId('audit-detail')).toContainText('birds_counted: 500 to 1000');
    await expect(page.getByTestId('audit-detail')).toContainText('Crate cap entered by mistake');
  });

  test('an entry with no stored details says so', async ({ page }) => {
    await world().install(page);
    await uiLogin(page, USERS.admin);
    await page.goto('/admin/audit');
    await page.getByTestId('audit-rows').getByText('Something unlabelled yet').click();
    await expect(page.getByTestId('audit-detail')).toContainText('No details were stored');
  });

  test('a buyer cannot open the audit log', async ({ page }) => {
    const m = world();
    m.addUser({ id: USERS.buyer.id, email: USERS.buyer.email, password: USERS.buyer.password, profile: { id: USERS.buyer.id, role: 'buyer', status: 'active', full_name: 'B', email: USERS.buyer.email, language: 'en' } });
    await m.install(page);
    await uiLogin(page, USERS.buyer);
    await page.goto('/admin/audit');
    await expect(page).toHaveURL(/\/orders$/);
  });
});
