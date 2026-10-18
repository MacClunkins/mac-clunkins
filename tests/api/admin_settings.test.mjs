// Admin settings and area writes go through RPCs. Admins have no direct write grant on
// settings or audit_log, so the RPC must do both writes and must refuse everyone else.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../rls/helpers.mjs';
import { ID, buildWorld, act, actTry } from './fixtures.mjs';

let c;
before(async () => { c = await connect(); });
after(async () => { await c.end(); });
beforeEach(async () => { await c.query('begin'); await buildWorld(c); });
afterEach(async () => { await c.query('rollback'); });

const sql = async (q, p = []) => (await c.query(q, p)).rows;

test('admin can change payments_mode and company_profile; each change is audited', async () => {
  const profile = { name: 'McCluckin\'s', address: '1 Test Rd', bank_name: 'Test Bank' };
  const [{ r }] = await act(c, ID.admin,
    'select public.admin_update_settings($1::jsonb) as r',
    [JSON.stringify({ payments_mode: 'paystack', company_profile: profile })]);
  assert.deepEqual([...r.changed].sort(), ['company_profile', 'payments_mode']);
  const [m] = await sql(`select value from public.settings where key = 'payments_mode'`);
  assert.equal(m.value, 'paystack');
  const [p] = await sql(`select value from public.settings where key = 'company_profile'`);
  assert.deepEqual(p.value, profile);
  const audit = await sql(`select entity_id, after from public.audit_log where action = 'settings.update' order by entity_id`);
  assert.deepEqual(audit.map((a) => a.entity_id), ['company_profile', 'payments_mode']);
  assert.equal(audit[1].after.value, 'paystack');
});

test('an unchanged value writes no audit row', async () => {
  const [{ r }] = await act(c, ID.admin, `select public.admin_update_settings('{"payments_mode":"manual"}'::jsonb) as r`);
  assert.deepEqual(r.changed, []);
  assert.equal((await sql(`select 1 from public.audit_log where action = 'settings.update'`)).length, 0);
});

test('bad values and unknown keys are rejected and change nothing', async () => {
  const bad = await actTry(c, ID.admin, `select public.admin_update_settings('{"payments_mode":"bitcoin"}'::jsonb)`);
  assert.equal(bad.error?.code, '22023');
  const unknown = await actTry(c, ID.admin, `select public.admin_update_settings('{"no_such_key":1}'::jsonb)`);
  assert.equal(unknown.error?.code, '22023');
  const notObject = await actTry(c, ID.admin, `select public.admin_update_settings('{"company_profile":"x"}'::jsonb)`);
  assert.equal(notObject.error?.code, '22023');
  assert.equal((await sql(`select value from public.settings where key = 'payments_mode'`))[0].value, 'manual');
});

test('keys outside the allowlist and out-of-range values are refused', async () => {
  await c.query(`insert into public.settings (key, value, is_public) values ('paystack_mode', '"test"', false) on conflict (key) do nothing`);
  for (const bad of [
    '{"paystack_mode":"live"}', '{"is_public":true}', '{"markup_pct":101}', '{"markup_pct":"15"}', '{"markup_pct":null}',
    '{"min_order":2.5}', '{"quote_hold_minutes":0}', '{"journey_warn_hours":25}',
  ]) {
    const r = await actTry(c, ID.admin, 'select public.admin_update_settings($1::jsonb)', [bad]);
    assert.equal(r.error?.code, '22023', bad);
  }
  assert.equal((await sql(`select value from public.settings where key = 'paystack_mode'`))[0].value, 'test');
  const ok = await actTry(c, ID.admin, `select public.admin_update_settings('{"markup_pct":12.5,"delivery_timeline":null}'::jsonb)`);
  assert.ok(!ok.error, ok.error?.message);
});

test('non-admins and anon cannot call the settings or area RPCs', async () => {
  for (const [uid, role] of [[ID.buyer, 'authenticated'], [ID.s4, 'authenticated'], [null, 'anon']]) {
    const s = await actTry(c, uid, `select public.admin_update_settings('{"payments_mode":"paystack"}'::jsonb)`, [], role);
    assert.equal(s.error?.code, '42501', `settings ${role}/${uid}`);
    const a = await actTry(c, uid, `select public.admin_update_area('GP', true, 1)`, [], role);
    assert.equal(a.error?.code, '42501', `area ${role}/${uid}`);
  }
  assert.equal((await sql(`select value from public.settings where key = 'payments_mode'`))[0].value, 'manual');
});

test('admin can update an area and it is audited; a bad launch order is refused', async () => {
  const [{ code }] = await sql('select code from public.provinces order by code limit 1');
  await act(c, ID.admin, 'select public.admin_update_area($1, true, 3)', [code]);
  const [a] = await sql('select active, launch_order from public.areas_served where province = $1', [code]);
  assert.deepEqual([a.active, a.launch_order], [true, 3]);
  assert.equal((await sql(`select 1 from public.audit_log where action = 'areas_served.update' and entity_id = $1`, [code])).length, 1);
  const bad = await actTry(c, ID.admin, 'select public.admin_update_area($1, true, 0)', [code]);
  assert.equal(bad.error?.code, '22023');
});
