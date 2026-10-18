// A supplier accepts, prepares and readies their own job through functions, because suppliers have no
// write grant on allocations. Everyone else, and every field outside the supplier's remit, is refused.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../rls/helpers.mjs';
import { ID, BIRD, BAND, buildWorld, act, actTry } from './fixtures.mjs';

let c;
before(async () => { c = await connect(); });
after(async () => { await c.end(); });
beforeEach(async () => { await c.query('begin'); await buildWorld(c); });
afterEach(async () => { await c.query('rollback'); });

const sql = async (q, p = []) => (await c.query(q, p)).rows;
const one = async (q, p = []) => (await sql(q, p))[0];

async function paidAllocation() {
  const [{ r }] = await act(c, ID.buyer, `select public.create_instant_quote($1, '${BIRD}', '${BAND}', 50) as r`, [ID.addrSoweto]);
  const [{ o }] = await act(c, ID.buyer, 'select public.accept_quote_create_order($1) as o', [r.quote_id]);
  const [{ p }] = await act(c, ID.buyer, 'select public.start_payment($1) as p', [o.order_id]);
  await act(c, null, 'select public.mark_order_paid($1, $2, $3, $4)', [p.reference, p.amount_cents, 'card', 100], 'service_role');
  return one('select id, status from public.allocations where order_id = $1', [o.order_id]);
}
const status = async (id) => (await one('select status from public.allocations where id = $1', [id])).status;

test('suppliers cannot write the allocations table directly', async () => {
  const al = await paidAllocation();
  const r = await actTry(c, ID.s4, `update public.allocations set status = 'accepted' where id = $1`, [al.id]);
  assert.equal(r.error?.code, '42501');
});

test('only the assigned supplier can respond; others are refused and nothing changes', async () => {
  const al = await paidAllocation();
  assert.equal(al.status, 'offered');
  for (const [uid, role] of [[ID.buyer, 'authenticated'], [ID.driver, 'authenticated'], [ID.admin, 'authenticated'], [null, 'anon']]) {
    const r = await actTry(c, uid, 'select public.supplier_respond_allocation($1, true)', [al.id], role);
    assert.ok(r.error, `${role}/${uid} must be refused`);
  }
  // another supplier cannot see it as theirs
  const other = await actTry(c, ID.s1, 'select public.supplier_respond_allocation($1, true)', [al.id]);
  assert.equal(other.error?.code, 'P0002');
  assert.equal(await status(al.id), 'offered');
});

test('accept, save details, mark ready; each step is audited and ready needs the checks', async () => {
  const al = await paidAllocation();
  // details cannot be saved before the job is accepted
  assert.ok((await actTry(c, ID.s4, `select public.supplier_update_allocation($1, '{"crates": 5}'::jsonb)`, [al.id])).error);
  await act(c, ID.s4, 'select public.supplier_respond_allocation($1, true)', [al.id]);
  assert.equal(await status(al.id), 'accepted');
  // a second answer is refused
  assert.equal((await actTry(c, ID.s4, 'select public.supplier_respond_allocation($1, false)', [al.id])).error?.code, 'P0001');

  // not ready until everything is in
  assert.match((await actTry(c, ID.s4, 'select public.supplier_mark_ready($1)', [al.id])).error.message, /need_count/);
  await act(c, ID.s4, `select public.supplier_update_allocation($1, '{"birds_counted": 50, "crates": 5, "welfare_ok": true}'::jsonb)`, [al.id]);
  assert.match((await actTry(c, ID.s4, 'select public.supplier_mark_ready($1)', [al.id])).error.message, /need_photo/);
  await act(c, ID.s4, `select public.supplier_update_allocation($1, $2::jsonb)`, [al.id, JSON.stringify({ load_photo_path: 'load/1.jpg' })]);
  assert.match((await actTry(c, ID.s4, 'select public.supplier_mark_ready($1)', [al.id])).error.message, /need_permit/);
  // Postgres now() is the transaction start, so use a time that is clearly in the past, not 'a minute ago'.
  const soon = new Date(Date.now() - 24 * 3600_000).toISOString();
  await act(c, ID.s4, `select public.supplier_update_allocation($1, $2::jsonb)`, [al.id, JSON.stringify({ removal_permit_path: 'permits/1.pdf', permit_valid_until: soon })]);
  assert.match((await actTry(c, ID.s4, 'select public.supplier_mark_ready($1)', [al.id])).error.message, /permit_expired/);
  await act(c, ID.s4, `select public.supplier_update_allocation($1, $2::jsonb)`, [al.id, JSON.stringify({ permit_valid_until: new Date(Date.now() + 36 * 3600_000).toISOString() })]);
  await act(c, ID.s4, 'select public.supplier_mark_ready($1)', [al.id]);
  assert.equal(await status(al.id), 'ready');

  const saved = await one('select birds_counted, crates, welfare_ok, load_photo_path from public.allocations where id = $1', [al.id]);
  assert.deepEqual([saved.birds_counted, saved.crates, saved.welfare_ok, saved.load_photo_path], [50, 5, true, 'load/1.jpg']);
  const actions = (await sql(`select action from public.audit_log where entity_id = $1 order by created_at`, [al.id])).map((a) => a.action);
  assert.ok(actions.includes('allocation.accepted') && actions.includes('allocation.ready'), actions.join(','));
});

test('a supplier cannot change price, status or anything outside the allowed details', async () => {
  const al = await paidAllocation();
  await act(c, ID.s4, 'select public.supplier_respond_allocation($1, true)', [al.id]);
  for (const bad of ['{"supplier_price_cents": 99999}', '{"status": "collected"}', '{"order_id": null}', '{"distance_km": 1}', '{"crates": -1}', '[1]']) {
    const r = await actTry(c, ID.s4, 'select public.supplier_update_allocation($1, $2::jsonb)', [al.id, bad]);
    assert.ok(r.error, `${bad} must be refused`);
  }
  const row = await one('select supplier_price_cents, status from public.allocations where id = $1', [al.id]);
  assert.deepEqual([row.supplier_price_cents, row.status], [9000, 'accepted']);
});

test('declining ends the job: it cannot be edited or readied afterwards', async () => {
  const al = await paidAllocation();
  await act(c, ID.s4, 'select public.supplier_respond_allocation($1, false)', [al.id]);
  assert.equal(await status(al.id), 'declined');
  assert.ok((await actTry(c, ID.s4, `select public.supplier_update_allocation($1, '{"crates": 5}'::jsonb)`, [al.id])).error);
  assert.ok((await actTry(c, ID.s4, 'select public.supplier_mark_ready($1)', [al.id])).error);
});
