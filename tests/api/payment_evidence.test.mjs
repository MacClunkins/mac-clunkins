// Evidence for money that moves outside the app: the buyer's slip, the bank's fee on the EFT, the bank
// statement, and proof of payment to the supplier and driver.
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

async function placedOrder() {
  const [{ r }] = await act(c, ID.buyer, `select public.create_instant_quote($1, '${BIRD}', '${BAND}', 50) as r`, [ID.addrSoweto]);
  const [{ o }] = await act(c, ID.buyer, 'select public.accept_quote_create_order($1) as o', [r.quote_id]);
  const order = await one('select id, total_cents from public.orders where id = $1', [o.order_id]);
  return order;
}

test('the bank fee on an EFT is recorded on the payment, and the old five-argument call still works', async () => {
  const o1 = await placedOrder();
  await act(c, ID.admin, `select public.admin_mark_order_paid($1, $2, 'eft', 'SLIP-1', 'EFT in', 1250)`, [o1.id, o1.total_cents]);
  const p1 = await one('select fee_cents, channel from public.payments where order_id = $1', [o1.id]);
  assert.equal(p1.fee_cents, 1250);
  assert.equal(p1.channel, null);
  assert.equal((await one(`select after from public.audit_log where action = 'payment.manual' and entity_id = $1`, [o1.id])).after.bank_fee_cents, 1250);

  const o2 = await placedOrder();
  await act(c, ID.admin, `select public.admin_mark_order_paid($1, $2, 'cash', null, null)`, [o2.id, o2.total_cents]);
  assert.equal((await one('select fee_cents from public.payments where order_id = $1', [o2.id])).fee_cents, null);

  const o3 = await placedOrder();
  assert.equal((await actTry(c, ID.admin, `select public.admin_mark_order_paid($1, $2, 'eft', null, null, -5)`, [o3.id, o3.total_cents])).error?.code, '22023');
  assert.equal((await one('select status from public.orders where id = $1', [o3.id])).status, 'placed');
});

test('a buyer sends proof of payment for their own order only, within limits', async () => {
  const o = await placedOrder();
  const path = `buyer/${ID.buyer}/slip-1.pdf`;
  const [{ id }] = await act(c, ID.buyer, 'select public.submit_payment_proof($1, $2, $3) as id', [o.id, path, 'FNB slip']);
  const row = await one('select * from public.payment_proofs where id = $1', [id]);
  assert.deepEqual([row.order_id, row.uploaded_by, row.file_path, row.note], [o.id, ID.buyer, path, 'FNB slip']);

  // someone else's order, someone else's folder, wrong role
  assert.equal((await actTry(c, ID.buyer2, 'select public.submit_payment_proof($1, $2)', [o.id, `buyer/${ID.buyer2}/x.pdf`])).error?.code, 'P0002');
  assert.equal((await actTry(c, ID.buyer, 'select public.submit_payment_proof($1, $2)', [o.id, `buyer/${ID.buyer2}/x.pdf`])).error?.code, '22023');
  assert.equal((await actTry(c, ID.buyer, 'select public.submit_payment_proof($1, $2)', [o.id, 'statement/x.pdf'])).error?.code, '22023');
  assert.equal((await actTry(c, ID.s4, 'select public.submit_payment_proof($1, $2)', [o.id, `buyer/${ID.s4}/x.pdf`])).error?.code, 'P0002');

  // who can read it
  assert.equal((await act(c, ID.buyer, 'select id from public.payment_proofs')).length, 1);
  assert.equal((await act(c, ID.buyer2, 'select id from public.payment_proofs')).length, 0);
  assert.equal((await act(c, ID.s4, 'select id from public.payment_proofs')).length, 0);
  assert.equal((await act(c, ID.admin, 'select id from public.payment_proofs')).length, 1);

  // ten at most
  for (let n = 0; n < 9; n += 1) await act(c, ID.buyer, 'select public.submit_payment_proof($1, $2)', [o.id, `buyer/${ID.buyer}/more-${n}.pdf`]);
  assert.match((await actTry(c, ID.buyer, 'select public.submit_payment_proof($1, $2)', [o.id, `buyer/${ID.buyer}/one-too-many.pdf`])).error.message, /too_many_proofs/);
});

test('bank statements are filed by admins only', async () => {
  await act(c, ID.admin, `select public.admin_add_bank_statement('statement/oct.pdf', '2026-10-01', '2026-10-31', 'October')`);
  const row = await one('select * from public.bank_statements');
  assert.deepEqual([row.file_path, row.note, row.uploaded_by], ['statement/oct.pdf', 'October', ID.admin]);
  assert.equal((await actTry(c, ID.buyer, `select public.admin_add_bank_statement('statement/x.pdf', null, null)`)).error?.code, '42501');
  assert.equal((await actTry(c, ID.admin, `select public.admin_add_bank_statement('buyer/x.pdf', null, null)`)).error?.code, '22023');
  assert.equal((await actTry(c, ID.admin, `select public.admin_add_bank_statement('statement/x.pdf', '2026-10-31', '2026-10-01')`)).error?.code, '22023');
  assert.equal((await act(c, ID.buyer, 'select id from public.bank_statements')).length, 0);
  assert.equal((await act(c, ID.s4, 'select id from public.bank_statements')).length, 0);
  assert.equal((await act(c, ID.admin, 'select id from public.bank_statements')).length, 1);
});

test('a payout is only marked paid with a reference and proof; the payee sees the proof, nobody else does; the order settles', async () => {
  const [{ r }] = await act(c, ID.buyer, `select public.create_instant_quote($1, '${BIRD}', '${BAND}', 50) as r`, [ID.addrSoweto]);
  const [{ o }] = await act(c, ID.buyer, 'select public.accept_quote_create_order($1) as o', [r.quote_id]);
  const total = (await one('select total_cents from public.orders where id = $1', [o.order_id])).total_cents;
  await act(c, ID.admin, `select public.admin_mark_order_paid($1, $2, 'eft', 'SLIP', null)`, [o.order_id, total]);
  const al = await one('select id from public.allocations where order_id = $1', [o.order_id]);
  const trip = await one('select id from public.trips where allocation_id = $1', [al.id]);
  const slot = await one(`insert into public.delivery_slots (label, start_time, end_time) values ('Morning', '08:00', '12:00') returning id`);
  await act(c, ID.admin, `select public.admin_schedule_order($1, current_date + 1, $2)`, [o.order_id, slot.id]);
  await act(c, ID.admin, 'select public.admin_assign_driver($1, $2)', [trip.id, ID.driver]);
  const code = (await one('select delivery_code from public.orders where id = $1', [o.order_id])).delivery_code;
  await act(c, ID.driver, 'select public.driver_confirm_pickup($1, 50)', [trip.id]);
  await act(c, ID.driver, 'select public.driver_confirm_delivery($1, $2)', [trip.id, code]);
  const sup = await one(`select id from public.transfers where party_type = 'supplier'`);
  const drv = await one(`select id from public.transfers where party_type = 'driver'`);

  // missing reference, missing or wrong proof path, not an admin
  assert.equal((await actTry(c, ID.admin, 'select public.admin_mark_transfer_paid($1, $2, null, $3)', [sup.id, 'x', `payout/${sup.id}/a.pdf`])).error?.code, '22023');
  assert.equal((await actTry(c, ID.admin, 'select public.admin_mark_transfer_paid($1, $2, null, null)', [sup.id, 'FNB-123'])).error?.code, '22023');
  assert.equal((await actTry(c, ID.admin, 'select public.admin_mark_transfer_paid($1, $2, null, $3)', [sup.id, 'FNB-123', `payout/${drv.id}/a.pdf`])).error?.code, '22023');
  assert.equal((await actTry(c, ID.s4, 'select public.admin_mark_transfer_paid($1, $2, null, $3)', [sup.id, 'FNB-123', `payout/${sup.id}/a.pdf`])).error?.code, '42501');
  assert.equal((await one('select status from public.transfers where id = $1', [sup.id])).status, 'queued');

  await act(c, ID.admin, 'select public.admin_mark_transfer_paid($1, $2, $3, $4)', [sup.id, 'FNB-123', 350, `payout/${sup.id}/slip.pdf`]);
  const done = await one('select status from public.transfers where id = $1', [sup.id]);
  assert.equal(done.status, 'success');
  const proof = await one('select reference, bank_fee_cents, file_path, uploaded_by from public.transfer_proofs where transfer_id = $1', [sup.id]);
  assert.deepEqual([proof.reference, proof.bank_fee_cents, proof.uploaded_by], ['FNB-123', 350, ID.admin]);
  assert.ok((await sql(`select 1 from public.audit_log where action = 'payout.paid_manual' and entity_id = $1`, [sup.id])).length);

  // the payee can read their proof; another supplier, the driver and the buyer cannot
  assert.equal((await act(c, ID.s4, 'select reference from public.transfer_proofs')).length, 1);
  assert.equal((await act(c, ID.s1, 'select reference from public.transfer_proofs')).length, 0);
  assert.equal((await act(c, ID.driver, 'select reference from public.transfer_proofs')).length, 0);
  assert.equal((await act(c, ID.buyer, 'select reference from public.transfer_proofs')).length, 0);

  // not twice, and the order settles once the last payout is recorded
  assert.match((await actTry(c, ID.admin, 'select public.admin_mark_transfer_paid($1, $2, null, $3)', [sup.id, 'FNB-123', `payout/${sup.id}/b.pdf`])).error.message, /already success/);
  assert.equal((await one('select status from public.orders where id = $1', [o.order_id])).status, 'delivered');
  await act(c, ID.admin, 'select public.admin_mark_transfer_paid($1, $2, null, $3)', [drv.id, 'FNB-456', `payout/${drv.id}/slip.pdf`]);
  assert.equal((await one('select status from public.orders where id = $1', [o.order_id])).status, 'settled');
  assert.equal((await act(c, ID.driver, 'select reference from public.transfer_proofs')).length, 1);
});
