// Incidents: raised by people, raised by the system, resolved by admins, and the admin tools that
// correct a count or confirm a delivery by hand. Every path leaves a trace without reading the database.
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

/** A paid order of 50 birds with an accepted allocation, a driver assigned and the order scheduled. */
async function job() {
  const [{ r }] = await act(c, ID.buyer, `select public.create_instant_quote($1, '${BIRD}', '${BAND}', 50) as r`, [ID.addrSoweto]);
  const [{ o }] = await act(c, ID.buyer, 'select public.accept_quote_create_order($1) as o', [r.quote_id]);
  const [{ p }] = await act(c, ID.buyer, 'select public.start_payment($1) as p', [o.order_id]);
  await act(c, null, 'select public.mark_order_paid($1, $2, $3, $4)', [p.reference, p.amount_cents, 'card', 100], 'service_role');
  const al = await one('select id from public.allocations where order_id = $1', [o.order_id]);
  const trip = await one('select id from public.trips where allocation_id = $1', [al.id]);
  const slot = await one(`insert into public.delivery_slots (label, start_time, end_time) values ('Morning', '08:00', '12:00') returning id`);
  await act(c, ID.admin, `select public.admin_schedule_order($1, current_date + 1, $2)`, [o.order_id, slot.id]);
  await act(c, ID.admin, 'select public.admin_assign_driver($1, $2)', [trip.id, ID.driver]);
  await act(c, ID.s4, 'select public.supplier_respond_allocation($1, true)', [al.id]);
  const code = (await one('select delivery_code from public.orders where id = $1', [o.order_id])).delivery_code;
  return { orderId: o.order_id, allocId: al.id, tripId: trip.id, code };
}
const incidents = (kind) => sql('select * from public.incidents where kind = $1 order by created_at', [kind]);

test('a short pickup raises an incident by itself, with the reason, and the supplier is paid for what was collected', async () => {
  const j = await job();
  await act(c, ID.driver, `select public.driver_confirm_pickup($1, 40, null, 'crates_too_few')`, [j.tripId]);
  const [inc] = await incidents('short_load');
  assert.ok(inc, 'a short_load incident must exist');
  assert.deepEqual([inc.severity, inc.source, inc.status, inc.raised_role], ['warn', 'auto', 'open', 'driver']);
  assert.match(inc.number, /^INC-\d{4}$/);
  assert.equal(inc.allocation_id, j.allocId);
  assert.equal(inc.data.ordered, 50);
  assert.equal(inc.data.collected, 40);
  assert.equal(inc.data.reason, 'crates_too_few');
  assert.equal((await one(`select amount_cents from public.transfers where party_type = 'supplier'`)).amount_cents, 9000 * 40);
});

test('a short pickup with no reason still raises the incident and does not block the driver', async () => {
  const j = await job();
  await act(c, ID.driver, 'select public.driver_confirm_pickup($1, 40)', [j.tripId]);
  const [inc] = await incidents('short_load');
  assert.equal(inc.data.reason, 'not given');
});

test('a full pickup raises nothing; a count that differs from the supplier\'s is recorded', async () => {
  const j = await job();
  await act(c, ID.s4, `select public.supplier_update_allocation($1, '{"birds_counted": 50, "crates": 5}'::jsonb)`, [j.allocId]);
  await act(c, ID.driver, 'select public.driver_confirm_pickup($1, 50)', [j.tripId]);
  assert.equal((await incidents('short_load')).length, 0);
  assert.equal((await incidents('count_mismatch')).length, 0);

  const k = await job();
  await act(c, ID.s4, `select public.supplier_update_allocation($1, '{"birds_counted": 50, "crates": 5}'::jsonb)`, [k.allocId]);
  await act(c, ID.driver, 'select public.driver_confirm_pickup($1, 45)', [k.tripId]);
  const [mm] = await incidents('count_mismatch');
  assert.equal(mm.data.supplier_count, 50);
  assert.equal(mm.data.driver_count, 45);
});

test('crates that cannot hold the order raise a capacity incident', async () => {
  const j = await job();
  await c.query(`insert into public.supplier_requirements (supplier_id, max_per_crate, disinfection_photo) values ($1, 10, false)
                 on conflict (supplier_id) do update set max_per_crate = 10, disinfection_photo = false`, [ID.s4]);
  await act(c, ID.s4, `select public.supplier_update_allocation($1, '{"crates": 2}'::jsonb)`, [j.allocId]);   // 2 x 10 = 20 < 50
  await act(c, ID.driver, 'select public.driver_confirm_pickup($1, 20)', [j.tripId]);
  const [cap] = await incidents('crate_capacity');
  assert.ok(cap);
  assert.equal(cap.data.crates, 2);
  assert.equal(cap.data.ordered, 50);
});

test('an admin corrects a wrong pickup count: the queued payout follows, the audit and the incident record it', async () => {
  const j = await job();
  await act(c, ID.driver, `select public.driver_confirm_pickup($1, 25, null, 'crates_too_few')`, [j.tripId]);
  const [inc] = await incidents('short_load');
  // only an admin, and only with a real reason
  assert.equal((await actTry(c, ID.driver, 'select public.admin_correct_pickup_count($1, 50, $2)', [j.allocId, 'trying it on'])).error?.code, '42501');
  assert.equal((await actTry(c, ID.admin, 'select public.admin_correct_pickup_count($1, 50, $2)', [j.allocId, 'no'])).error?.code, '22023');
  assert.equal((await actTry(c, ID.admin, 'select public.admin_correct_pickup_count($1, 51, $2)', [j.allocId, 'more than ordered'])).error?.code, '22023');

  await act(c, ID.admin, 'select public.admin_correct_pickup_count($1, 50, $2, $3)', [j.allocId, 'Crate count was entered too low', inc.id]);
  const a = await one('select birds_counted from public.allocations where id = $1', [j.allocId]);
  const t = await one('select pickup_count from public.trips where id = $1', [j.tripId]);
  assert.deepEqual([a.birds_counted, t.pickup_count], [50, 50]);
  assert.equal((await one(`select amount_cents from public.transfers where party_type = 'supplier'`)).amount_cents, 9000 * 50);
  const audit = await one(`select before, after from public.audit_log where action = 'admin.correction' and entity_id = $1`, [j.allocId]);
  assert.equal(audit.before.birds_counted, 25);
  assert.equal(audit.after.birds_counted, 50);
  assert.match(audit.after.reason, /entered too low/);
  // the driver who raised it can read the correction
  const seen = await act(c, ID.driver, 'select body from public.incident_events where incident_id = $1', [inc.id]);
  assert.match(seen[0].body, /corrected from 25 to 50/);
});

test('once a supplier payout has been sent the count cannot be changed from here', async () => {
  const j = await job();
  await act(c, ID.driver, 'select public.driver_confirm_pickup($1, 25)', [j.tripId]);
  await c.query(`update public.transfers set status = 'sent' where party_type = 'supplier'`);
  const r = await actTry(c, ID.admin, 'select public.admin_correct_pickup_count($1, 50, $2)', [j.allocId, 'too late to change']);
  assert.match(r.error.message, /payout_already_sent/);
  assert.equal((await one('select birds_counted from public.allocations where id = $1', [j.allocId])).birds_counted, 25);
});

test('suppliers and drivers can raise a problem on their own job only, with limits', async () => {
  const j = await job();
  const ok = await act(c, ID.s4, `select public.raise_incident('crate_capacity', $1, null, 'Crates too few', 'Only 5 crates on site') as id`, [j.allocId]);
  const mine = await one('select * from public.incidents where id = $1', [ok[0].id]);
  assert.deepEqual([mine.kind, mine.source, mine.raised_by, mine.raised_role, mine.order_id], ['crate_capacity', 'user', ID.s4, 'supplier', j.orderId]);

  // not someone else's job
  assert.equal((await actTry(c, ID.s1, `select public.raise_incident('other', $1, null, 'Not mine', null)`, [j.allocId])).error?.code, 'P0002');
  // not a buyer, not anonymous
  assert.equal((await actTry(c, ID.buyer, `select public.raise_incident('other', null, null, 'Hello there', null)`)).error?.code, '42501');
  assert.ok((await actTry(c, null, `select public.raise_incident('other', null, null, 'Hello there', null)`, [], 'anon')).error);
  // bad kind, bad title
  assert.equal((await actTry(c, ID.s4, `select public.raise_incident('delivery_override', null, null, 'Pretend admin', null)`)).error?.code, '22023');
  assert.equal((await actTry(c, ID.s4, `select public.raise_incident('other', null, null, 'x', null)`)).error?.code, '22023');
  // a driver can report against their trip
  const d = await act(c, ID.driver, `select public.raise_incident('access', null, $1, 'Gate was locked', 'Waited 40 minutes') as id`, [j.tripId]);
  assert.equal((await one('select allocation_id from public.incidents where id = $1', [d[0].id])).allocation_id, j.allocId);

  // visibility: the raiser and admins see it, other suppliers do not
  assert.equal((await act(c, ID.s4, 'select id from public.incidents')).length, 1);
  assert.equal((await act(c, ID.s1, 'select id from public.incidents')).length, 0);
  assert.equal((await act(c, ID.buyer, 'select id from public.incidents')).length, 0);
  assert.equal((await act(c, ID.admin, 'select id from public.incidents')).length, 2);

  // at most ten reports a day
  for (let n = 0; n < 9; n += 1) await act(c, ID.s4, `select public.raise_incident('other', null, null, $1, null)`, [`Report number ${n}`]);
  assert.match((await actTry(c, ID.s4, `select public.raise_incident('other', null, null, 'One too many', null)`)).error.message, /too_many_reports/);
});

test('admins work an incident: a note is needed to close it, and the reporter only sees notes shared with them', async () => {
  const j = await job();
  const [{ id }] = await act(c, ID.s4, `select public.raise_incident('payout_question', $1, null, 'Payout looks low', 'Expected more') as id`, [j.allocId]);
  assert.equal((await actTry(c, ID.s4, `select public.admin_update_incident($1, 'resolved', 'self-resolved', true)`, [id])).error?.code, '42501');
  assert.equal((await actTry(c, ID.admin, `select public.admin_update_incident($1, 'resolved', '', false)`, [id])).error?.code, '22023');
  await act(c, ID.admin, `select public.admin_update_incident($1, 'in_review', 'Checking the counts', false)`, [id]);
  assert.equal((await act(c, ID.s4, 'select * from public.incident_events where incident_id = $1', [id])).length, 0, 'an internal note is hidden');
  await act(c, ID.admin, `select public.admin_update_incident($1, 'resolved', 'Count corrected, payout updated', true)`, [id]);
  const inc = await one('select status, resolved_by, resolved_at, resolution_note from public.incidents where id = $1', [id]);
  assert.equal(inc.status, 'resolved');
  assert.equal(inc.resolved_by, ID.admin);
  assert.ok(inc.resolved_at);
  const shared = await act(c, ID.s4, 'select body from public.incident_events where incident_id = $1', [id]);
  assert.deepEqual(shared.map((e) => e.body), ['Count corrected, payout updated']);
  assert.ok((await sql(`select 1 from public.audit_log where action = 'incident.updated' and entity_id = $1`, [id])).length >= 2);
});

test('a job marked ready is locked: the supplier cannot quietly change the count or crates', async () => {
  const j = await job();
  await act(c, ID.s4, `select public.supplier_update_allocation($1, $2::jsonb)`, [j.allocId, JSON.stringify({
    birds_counted: 50, crates: 5, welfare_ok: true, load_photo_path: 'load/1.jpg', removal_permit_path: 'permits/1.pdf',
    permit_valid_until: new Date(Date.now() + 36 * 3600_000).toISOString() })]);
  await act(c, ID.s4, 'select public.supplier_mark_ready($1)', [j.allocId]);
  const r = await actTry(c, ID.s4, `select public.supplier_update_allocation($1, '{"crates": 1}'::jsonb)`, [j.allocId]);
  assert.match(r.error.message, /job_locked/);
  assert.equal((await one('select crates from public.allocations where id = $1', [j.allocId])).crates, 5);
});

test('an admin can confirm a delivery by hand, and it is recorded as an incident', async () => {
  const j = await job();
  await act(c, ID.driver, 'select public.driver_confirm_pickup($1, 50)', [j.tripId]);
  assert.equal((await actTry(c, ID.driver, `select public.admin_force_delivery($1, 50, 'driver wants it done')`, [j.tripId])).error?.code, '42501');
  assert.equal((await actTry(c, ID.admin, `select public.admin_force_delivery($1, 50, 'no')`, [j.tripId])).error?.code, '22023');
  assert.match((await actTry(c, ID.admin, `select public.admin_force_delivery($1, 60, 'count above collected')`, [j.tripId])).error.message, /delivered_more_than_collected/);

  await act(c, ID.admin, `select public.admin_force_delivery($1, 50, 'Buyer confirmed by phone, code lost')`, [j.tripId]);
  assert.equal((await one('select status from public.trips where id = $1', [j.tripId])).status, 'delivered');
  assert.equal((await one('select status from public.orders where id = $1', [j.orderId])).status, 'delivered');
  assert.equal((await one(`select count(*)::int n from public.transfers where party_type = 'driver'`)).n, 1);
  const [inc] = await incidents('delivery_override');
  assert.deepEqual([inc.source, inc.severity, inc.details], ['admin', 'warn', 'Buyer confirmed by phone, code lost']);
  assert.ok((await sql(`select 1 from public.audit_log where action = 'admin.force_delivery' and entity_id = $1`, [j.tripId])).length);
  // doing it twice is refused
  assert.match((await actTry(c, ID.admin, `select public.admin_force_delivery($1, 50, 'again for luck')`, [j.tripId])).error.message, /trip_not_in_transit/);
});
