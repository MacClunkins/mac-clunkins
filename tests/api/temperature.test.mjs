// The driver's temperature (forecast or thermometer) is stored with its source, a reading is never replaced by
// a forecast, and the heat limit is readable by the driver app.
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

async function assignedTrip() {
  const [{ r }] = await act(c, ID.buyer, `select public.create_instant_quote($1, '${BIRD}', '${BAND}', 50) as r`, [ID.addrSoweto]);
  const [{ o }] = await act(c, ID.buyer, 'select public.accept_quote_create_order($1) as o', [r.quote_id]);
  const [{ p }] = await act(c, ID.buyer, 'select public.start_payment($1) as p', [o.order_id]);
  await act(c, null, 'select public.mark_order_paid($1, $2, $3, $4)', [p.reference, p.amount_cents, 'card', 100], 'service_role');
  const trip = await one('select t.id from public.trips t join public.allocations a on a.id = t.allocation_id where a.order_id = $1', [o.order_id]);
  await act(c, ID.admin, 'select public.admin_assign_driver($1, $2)', [trip.id, ID.driver]);
  return trip.id;
}

test('a forecast is stored with its source and the driver sees it on their trip', async () => {
  const id = await assignedTrip();
  await act(c, ID.driver, `select public.driver_record_temperature($1, 31.44, 'forecast')`, [id]);
  const [row] = await act(c, ID.driver, 'select forecast_temp_c, temp_source from public.driver_trips where id = $1', [id]);
  assert.deepEqual([Number(row.forecast_temp_c), row.temp_source], [31.4, 'forecast']);
  const audit = await one(`select after from public.audit_log where action = 'trip.temperature' and entity_id = $1`, [id]);
  assert.deepEqual([audit.after.temp_c, audit.after.source], [31.4, 'forecast']);
});

test('a thermometer reading replaces a forecast, and a later forecast never replaces a reading', async () => {
  const id = await assignedTrip();
  await act(c, ID.driver, `select public.driver_record_temperature($1, 28, 'forecast')`, [id]);
  await act(c, ID.driver, `select public.driver_record_temperature($1, 34.5, 'measured')`, [id]);
  await act(c, ID.driver, `select public.driver_record_temperature($1, 22, 'forecast')`, [id]);
  const row = await one('select forecast_temp_c, temp_source from public.trips where id = $1', [id]);
  assert.deepEqual([Number(row.forecast_temp_c), row.temp_source], [34.5, 'measured']);
});

test('bad values, wrong people and finished trips are refused', async () => {
  const id = await assignedTrip();
  assert.equal((await actTry(c, ID.driver, `select public.driver_record_temperature($1, 80, 'measured')`, [id])).error?.code, '22023');
  assert.equal((await actTry(c, ID.driver, `select public.driver_record_temperature($1, -20, 'measured')`, [id])).error?.code, '22023');
  assert.equal((await actTry(c, ID.driver, `select public.driver_record_temperature($1, 20, 'guess')`, [id])).error?.code, '22023');
  assert.equal((await actTry(c, ID.buyer, `select public.driver_record_temperature($1, 20, 'measured')`, [id])).error?.code, '42501');
  assert.equal((await actTry(c, ID.admin, `select public.driver_record_temperature($1, 20, 'measured')`, [id])).error?.code, '42501');
  assert.ok((await actTry(c, null, `select public.driver_record_temperature($1, 20, 'measured')`, [id], 'anon')).error);
  await c.query(`update public.trips set status = 'delivered' where id = $1`, [id]);
  assert.match((await actTry(c, ID.driver, `select public.driver_record_temperature($1, 20, 'measured')`, [id])).error.message, /trip is delivered/);
  assert.equal((await one('select forecast_temp_c from public.trips where id = $1', [id])).forecast_temp_c, null);
});

test('admins see the source; the heat limit is a public setting', async () => {
  const id = await assignedTrip();
  await act(c, ID.driver, `select public.driver_record_temperature($1, 33, 'measured')`, [id]);
  const [row] = await act(c, ID.admin, 'select forecast_temp_c, temp_source from public.admin_trips where id = $1', [id]);
  assert.deepEqual([Number(row.forecast_temp_c), row.temp_source], [33, 'measured']);
  const heat = await act(c, null, `select value from public.settings where key = 'heat_warn_c'`, [], 'anon');
  assert.equal(heat.length, 1);
});
