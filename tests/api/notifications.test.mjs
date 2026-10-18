// The inbox: the moments people wait for create a notification, only the owner reads it, opening marks it read,
// and a notification can never block the thing that triggered it.
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
const templates = async (profile) => (await sql('select template from public.notifications where profile_id = $1 order by created_at, template', [profile])).map((r) => r.template);

test('a paid, scheduled, collected and delivered order tells the buyer, the supplier and the driver at each step', async () => {
  const [{ r }] = await act(c, ID.buyer, `select public.create_instant_quote($1, '${BIRD}', '${BAND}', 50) as r`, [ID.addrSoweto]);
  const [{ o }] = await act(c, ID.buyer, 'select public.accept_quote_create_order($1) as o', [r.quote_id]);
  const total = (await one('select total_cents from public.orders where id = $1', [o.order_id])).total_cents;
  await act(c, ID.admin, `select public.admin_mark_order_paid($1, $2, 'eft', 'SLIP', null)`, [o.order_id, total]);

  assert.deepEqual(await templates(ID.buyer), ['order_paid']);
  assert.deepEqual(await templates(ID.s4), ['job_offered']);
  const offered = await one(`select payload from public.notifications where template = 'job_offered'`);
  assert.equal(offered.payload.quantity, 50);

  const al = await one('select id from public.allocations where order_id = $1', [o.order_id]);
  const trip = await one('select id from public.trips where allocation_id = $1', [al.id]);
  const slot = await one(`insert into public.delivery_slots (label, start_time, end_time) values ('Morning', '08:00', '12:00') returning id`);
  await act(c, ID.admin, `select public.admin_schedule_order($1, current_date + 1, $2)`, [o.order_id, slot.id]);
  await act(c, ID.admin, 'select public.admin_assign_driver($1, $2)', [trip.id, ID.driver]);
  assert.deepEqual(await templates(ID.driver), ['trip_assigned']);

  const code = (await one('select delivery_code from public.orders where id = $1', [o.order_id])).delivery_code;
  await act(c, ID.driver, 'select public.driver_confirm_pickup($1, 50)', [trip.id]);
  await act(c, ID.driver, 'select public.driver_confirm_delivery($1, $2)', [trip.id, code]);
  assert.deepEqual((await templates(ID.buyer)).sort(), ['order_delivered', 'order_on_the_way', 'order_paid', 'order_scheduled']);

  // a payout recorded as paid tells the person paid
  const sup = await one(`select id from public.transfers where party_type = 'supplier'`);
  await c.query(`update public.transfers set status = 'success' where id = $1`, [sup.id]);
  assert.ok((await templates(ID.s4)).includes('payout_paid'));
  assert.equal((await one(`select payload from public.notifications where template = 'payout_paid'`)).payload.amount_cents, 9000 * 50);
});

test('people read only their own notifications, and opening the inbox marks them read', async () => {
  const [{ r }] = await act(c, ID.buyer, `select public.create_instant_quote($1, '${BIRD}', '${BAND}', 50) as r`, [ID.addrSoweto]);
  const [{ o }] = await act(c, ID.buyer, 'select public.accept_quote_create_order($1) as o', [r.quote_id]);
  await c.query(`update public.orders set status = 'cancelled', cancelled_at = now() where id = $1`, [o.order_id]);
  assert.equal((await act(c, ID.buyer, 'select template from public.notifications')).length, 1);
  assert.equal((await act(c, ID.buyer2, 'select template from public.notifications')).length, 0);
  assert.equal((await act(c, ID.s4, 'select template from public.notifications')).length, 0);

  assert.equal((await act(c, ID.buyer, 'select id from public.notifications where read_at is null')).length, 1);
  await act(c, ID.buyer, 'select public.mark_notifications_read()');
  assert.equal((await act(c, ID.buyer, 'select id from public.notifications where read_at is null')).length, 0);
  // marking one person's inbox read does not touch anyone else's
  await c.query(`insert into public.notifications (profile_id, template, language, channel) values ($1, 'x', 'en', 'whatsapp')`, [ID.buyer2]);
  await act(c, ID.buyer, 'select public.mark_notifications_read()');
  assert.equal((await one('select read_at from public.notifications where profile_id = $1', [ID.buyer2])).read_at, null);
  // nobody can write notifications directly or call the internal helper
  assert.equal((await actTry(c, ID.buyer, `insert into public.notifications (profile_id, template, language, channel) values ($1, 'x', 'en', 'whatsapp')`, [ID.buyer])).error?.code, '42501');
  assert.equal((await actTry(c, ID.buyer, `select public._notify($1, 'x', '{}')`, [ID.buyer])).error?.code, '42501');
  assert.ok((await actTry(c, null, 'select public.mark_notifications_read()', [], 'anon')).error);
});

test('a notification that cannot be written never blocks the order from moving', async () => {
  const [{ r }] = await act(c, ID.buyer, `select public.create_instant_quote($1, '${BIRD}', '${BAND}', 50) as r`, [ID.addrSoweto]);
  const [{ o }] = await act(c, ID.buyer, 'select public.accept_quote_create_order($1) as o', [r.quote_id]);
  await c.query(`alter table public.notifications add constraint no_notifications_for_test check (false) not valid`);
  await c.query(`update public.orders set status = 'cancelled', cancelled_at = now() where id = $1`, [o.order_id]);
  assert.equal((await one('select status from public.orders where id = $1', [o.order_id])).status, 'cancelled');
});
