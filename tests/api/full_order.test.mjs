// A whole order against the real SQL, role by role, manual-payments mode:
//   buyer asks for a quote -> (admin prices it if it is a request) -> buyer places the order and gets EFT
//   details -> admin records the payment -> admin schedules and assigns a driver -> driver collects and
//   delivers with the buyer's code -> buyer-facing tracking -> payouts are queued.
// Each step also checks what the other roles can and cannot see.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../rls/helpers.mjs';
import { ID, BIRD, BAND, buildWorld, setSetting, act, actTry } from './fixtures.mjs';

let c;
before(async () => { c = await connect(); });
after(async () => { await c.end(); });
beforeEach(async () => { await c.query('begin'); await buildWorld(c); });
afterEach(async () => { await c.query('rollback'); });

const sql = async (q, p = []) => (await c.query(q, p)).rows;
const one = async (q, p = []) => (await sql(q, p))[0];

async function requestQuote(qty) {
  const [{ r }] = await act(c, ID.buyer, `select public.create_instant_quote($1, '${BIRD}', '${BAND}', $2) as r`, [ID.addrSoweto, qty]);
  return r;
}

async function placeAndPay(quote) {
  const [{ o }] = await act(c, ID.buyer, 'select public.accept_quote_create_order($1) as o', [quote.quote_id]);
  const order = await one('select * from public.orders where id = $1', [o.order_id]);
  assert.equal(order.status, 'placed');

  // An invoice is issued as soon as the order exists, and the buyer gets the EFT details.
  const inv = await sql(`select kind, number, amount_cents from public.billing_documents where order_id = $1`, [order.id]);
  assert.deepEqual(inv.map((d) => d.kind), ['invoice']);
  assert.equal(inv[0].amount_cents, order.total_cents);
  const [{ i }] = await act(c, ID.buyer, 'select public.get_payment_instructions($1) as i', [order.id]);
  assert.equal(i.amount_cents, order.total_cents);
  assert.equal(i.reference, order.number);

  // Nothing is sourced until the money is recorded; the buyer cannot mark their own order paid.
  assert.equal((await sql('select 1 from public.allocations where order_id = $1', [order.id])).length, 0);
  const self = await actTry(c, ID.buyer, `select public.admin_mark_order_paid($1, $2, 'eft', 'X', null)`, [order.id, order.total_cents]);
  assert.equal(self.error?.code, '42501');

  // A part payment is refused; the exact amount is accepted.
  const short = await actTry(c, ID.admin, `select public.admin_mark_order_paid($1, $2, 'eft', 'SLIP-1', null)`, [order.id, order.total_cents - 100]);
  assert.ok(short.error, 'a short payment must be refused');
  await act(c, ID.admin, `select public.admin_mark_order_paid($1, $2, 'eft', 'SLIP-1', 'EFT received')`, [order.id, order.total_cents]);
  const paid = await one('select status, paid_at, delivery_code from public.orders where id = $1', [order.id]);
  assert.equal(paid.status, 'paid');
  assert.ok(paid.paid_at);
  assert.match(paid.delivery_code, /^\d{4}$/);
  assert.deepEqual((await sql(`select kind from public.billing_documents where order_id = $1 order by kind`, [order.id])).map((d) => d.kind), ['invoice', 'receipt']);
  return { order, code: paid.delivery_code };
}

async function deliver(order, code, birds) {
  const trip = await one(`select t.id, t.driver_id from public.trips t join public.allocations a on a.id = t.allocation_id where a.order_id = $1`, [order.id]);
  assert.equal(trip.driver_id, null, 'no driver until the admin picks one');

  // Admin schedules and assigns the driver.
  const slot = (await sql('select id from public.delivery_slots where active order by start_time limit 1'))[0]
    ?? await one(`insert into public.delivery_slots (label, start_time, end_time) values ('Morning', '08:00', '12:00') returning id`);
  await act(c, ID.admin, `select public.admin_schedule_order($1, current_date + 2, $2)`, [order.id, slot.id]);
  assert.equal((await one('select status from public.orders where id = $1', [order.id])).status, 'scheduled');
  await act(c, ID.admin, 'select public.admin_assign_driver($1, $2)', [trip.id, ID.driver]);

  // The buyer's tracking view: driver first name and a phone number, never supplier details.
  const [{ t }] = await act(c, ID.buyer, 'select public.buyer_order_tracking($1) as t', [order.id]);
  assert.ok(t.driver_first_name);
  assert.ok(!JSON.stringify(t).includes(ID.s4));
  // Another buyer gets nothing.
  assert.equal((await act(c, ID.buyer2, 'select public.buyer_order_tracking($1) as t', [order.id]))[0].t, null);

  // Driver collects (supplier is queued for payout) then delivers with the buyer's code.
  await act(c, ID.driver, 'select public.driver_confirm_pickup($1, $2)', [trip.id, birds]);
  assert.equal((await one('select status from public.orders where id = $1', [order.id])).status, 'on_the_way');
  await assert.rejects(act(c, ID.driver, 'select public.driver_confirm_delivery($1, $2)', [trip.id, String((Number(code) + 1) % 10000).padStart(4, '0')]), /invalid_delivery_code/);
  await act(c, ID.driver, 'select public.driver_confirm_delivery($1, $2)', [trip.id, code]);
  assert.equal((await one('select status from public.orders where id = $1', [order.id])).status, 'delivered');

  const transfers = await sql(`select party_type, amount_cents, status from public.transfers order by party_type`);
  assert.deepEqual(transfers.map((t) => [t.party_type, t.status]).sort(), [['driver', 'queued'], ['supplier', 'queued']]);
  return transfers;
}

test('instant quote -> EFT -> paid -> scheduled -> collected -> delivered -> payouts queued', async () => {
  const quote = await requestQuote(50);
  assert.equal(quote.kind, 'instant');
  const { order, code } = await placeAndPay(quote);

  // Privacy at the paid stage.
  const sup = await act(c, ID.s4, 'select * from public.supplier_allocations');
  assert.equal(sup.length, 1);
  assert.equal(sup[0].supplier_price_cents, 9000);
  assert.ok(!('buyer_id' in sup[0]) && !('address_id' in sup[0]));
  assert.equal((await act(c, ID.s1, 'select * from public.supplier_allocations')).length, 0, 'other suppliers see nothing');
  const buyerSees = await act(c, ID.buyer, 'select * from public.orders where id = $1', [order.id]);
  assert.equal(buyerSees.length, 1);
  assert.ok(!JSON.stringify(buyerSees).includes('9000'));

  const transfers = await deliver(order, code, 50);
  assert.equal(transfers.find((t) => t.party_type === 'supplier').amount_cents, 9000 * 50);
});

test('requested quote: buyer asks, admin prices, buyer places, the rest follows', async () => {
  // Above rfq_min_birds the buyer cannot get an instant price; the quote waits for an admin.
  const req = await requestQuote(400);
  assert.equal(req.kind, 'requested');
  assert.equal(req.total_cents ?? null, null);

  // The admin sees it waiting in the admin_quotes view; a buyer reading that view gets nothing.
  const waiting = await act(c, ID.admin, `select id, kind, status, total_cents from public.admin_quotes where status = 'open' and total_cents is null`);
  assert.deepEqual(waiting.map((w) => w.id), [req.quote_id]);
  assert.equal((await act(c, ID.buyer, 'select * from public.admin_quotes')).length, 0);

  // A buyer cannot place an unpriced quote.
  const early = await actTry(c, ID.buyer, 'select public.accept_quote_create_order($1)', [req.quote_id]);
  assert.ok(early.error, 'an unpriced quote cannot be placed');

  const cands = await act(c, ID.admin, 'select * from public.admin_match_preview($1)', [req.quote_id]);
  assert.ok(cands.length >= 2);
  await act(c, ID.admin, 'select public.admin_price_quote($1, $2::jsonb)', [req.quote_id,
    JSON.stringify([{ supplier_id: ID.s4, birds: 200, price_cents: 9000 }, { supplier_id: ID.s2, birds: 200, price_cents: 7000 }])]);
  const priced = await one('select total_cents, expires_at, status from public.quotes where id = $1', [req.quote_id]);
  assert.ok(priced.total_cents > 0);
  assert.equal(priced.status, 'open');

  // The buyer sees the price, not who fills it.
  const [view] = await act(c, ID.buyer, 'select * from public.buyer_quotes where id = $1', [req.quote_id]);
  assert.equal(view.total_cents, priced.total_cents);
  assert.ok(!('matched_supplier_id' in view) && !('supplier_price_cents' in view));
  // The cost detail is on the admin-only table.
  const costs = await act(c, ID.admin, 'select matched_supplier_id, breakdown from public.quote_costs where quote_id = $1', [req.quote_id]);
  assert.equal(costs.length, 1);
  assert.equal(costs[0].breakdown.allocations.length, 2);

  const { order } = await placeAndPay({ quote_id: req.quote_id });
  // Two suppliers fill a requested quote, so two allocations and two trips exist after payment.
  assert.equal((await sql('select count(*)::int n from public.allocations where order_id = $1', [order.id]))[0].n, 2);
  assert.equal((await sql(`select count(*)::int n from public.trips t join public.allocations a on a.id = t.allocation_id where a.order_id = $1`, [order.id]))[0].n, 2);
});

test('a cancelled-by-timeout order cannot be paid by an admin', async () => {
  const quote = await requestQuote(50);
  const [{ o }] = await act(c, ID.buyer, 'select public.accept_quote_create_order($1) as o', [quote.quote_id]);
  await c.query(`update public.orders set status = 'cancelled', cancelled_at = now() where id = $1`, [o.order_id]);
  const total = (await one('select total_cents from public.orders where id = $1', [o.order_id])).total_cents;
  const r = await actTry(c, ID.admin, `select public.admin_mark_order_paid($1, $2, 'eft', 'LATE', null)`, [o.order_id, total]);
  assert.ok(r.error, 'a closed order must not be marked paid');
  assert.equal((await one('select status from public.orders where id = $1', [o.order_id])).status, 'cancelled');
});

test('tracking: window ETA before pickup, live position and ETA on the road, nothing for others, nothing after delivery', async () => {
  const quote = await requestQuote(50);
  const { order, code } = await placeAndPay(quote);
  const trip = await one(`select t.id from public.trips t join public.allocations a on a.id = t.allocation_id where a.order_id = $1`, [order.id]);
  const slot = await one(`insert into public.delivery_slots (label, start_time, end_time) values ('Morning', '08:00', '12:00') returning id`);
  await act(c, ID.admin, `select public.admin_schedule_order($1, current_date + 1, $2)`, [order.id, slot.id]);
  await act(c, ID.admin, 'select public.admin_assign_driver($1, $2)', [trip.id, ID.driver]);

  const track = async (uid = ID.buyer) => (await act(c, uid, 'select public.buyer_order_tracking($1) as t', [order.id]))[0].t;

  // Before pickup: the end of the delivery window, no position.
  let t = await track();
  assert.equal(t.eta_source, 'window');
  assert.ok(t.eta_at);
  assert.equal(t.lat, null);
  // The window ends at 12:00 Johannesburg time tomorrow.
  const hh = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t.eta_at));
  assert.equal(hh, '12:00');

  // Positions before pickup are ignored.
  await act(c, ID.driver, 'select public.driver_update_location($1, -26.2, 27.9)', [trip.id]);
  assert.equal((await sql('select 1 from public.trip_locations')).length, 0);

  await act(c, ID.driver, 'select public.driver_confirm_pickup($1, 50)', [trip.id]);
  // On the road but no position yet: still the window.
  assert.equal((await track()).eta_source, 'window');

  // Wrong role, wrong driver, bad numbers.
  assert.equal((await actTry(c, ID.buyer, 'select public.driver_update_location($1, -26.2, 27.9)', [trip.id])).error?.code, '42501');
  assert.ok((await actTry(c, ID.driver, 'select public.driver_update_location($1, 95, 27.9)', [trip.id])).error);
  assert.ok((await actTry(c, ID.driver, 'select public.driver_update_location($1, -26.2, 200)', [trip.id])).error);

  // ~38 km from Soweto (-26.2378, 27.8546): the live ETA is distance x road factor / speed from now.
  await act(c, ID.driver, 'select public.driver_update_location($1, -25.8, 28.2)', [trip.id]);
  t = await track();
  assert.equal(t.eta_source, 'live');
  assert.equal(t.lat, -25.8);
  assert.equal(t.lng, 28.2);
  const mins = (new Date(t.eta_at) - Date.now()) / 60000;
  assert.ok(mins > 30 && mins < 120, `expected an hour-ish ETA for ~60 km, got ${mins.toFixed(0)} min`);
  // Closer position -> earlier ETA.
  await act(c, ID.driver, 'select public.driver_update_location($1, -26.23, 27.86)', [trip.id]);
  const closer = await track();
  assert.ok(new Date(closer.eta_at) < new Date(t.eta_at));

  // The position is private to the buyer who owns the order and not stored anywhere readable.
  assert.equal(await track(ID.buyer2), null);
  assert.equal((await act(c, ID.buyer, 'select * from public.trip_locations').catch(() => 'denied')), 'denied');
  const stale = await c.query(`update public.trip_locations set updated_at = now() - interval '31 minutes'`);
  assert.equal(stale.rowCount, 1);
  assert.equal((await track()).lat, null, 'a stale position is hidden');

  // After delivery there is no live position and no ETA.
  await act(c, ID.driver, 'select public.driver_update_location($1, -26.23, 27.86)', [trip.id]);
  await act(c, ID.driver, 'select public.driver_confirm_delivery($1, $2)', [trip.id, code]);
  t = await track();
  assert.equal(t.lat, null);
  assert.equal(t.eta_at, null);
  // And a late position after delivery is ignored.
  await act(c, ID.driver, 'select public.driver_update_location($1, -26.2, 27.9)', [trip.id]);
});

test('admin_quote_candidates explains why a supplier is left out, and ranks the ones that qualify', async () => {
  const req = (await requestQuote(400));
  assert.equal(req.kind, 'requested');
  const rows = await act(c, ID.admin, 'select * from public.admin_quote_candidates($1)', [req.quote_id]);
  const by = Object.fromEntries(rows.map((r) => [r.supplier_id, r]));
  assert.equal(by[ID.s4].eligible, true);
  assert.deepEqual(by[ID.s4].reasons, []);
  assert.ok(by[ID.s4].rank >= 1);
  // The fixtures exclude each of these for exactly one reason.
  assert.deepEqual(by[ID.paused].reasons, ['paused']);
  assert.deepEqual(by[ID.noDoc].reasons, ['docs']);
  assert.deepEqual(by[ID.pending].reasons, ['not_active']);
  assert.deepEqual(by[ID.controlled].reasons, ['flu_zone']);
  assert.deepEqual(by[ID.inactivePrice].reasons, ['no_price']);
  // No location -> named, and no driver -> named for every supplier.
  await c.query('update public.supplier_details set location = null where profile_id = $1', [ID.s4]);
  const noLoc = (await act(c, ID.admin, 'select * from public.admin_quote_candidates($1)', [req.quote_id])).find((r) => r.supplier_id === ID.s4);
  assert.equal(noLoc.eligible, false);
  assert.ok(noLoc.reasons.includes('no_location'));
  await c.query('update public.driver_details set capacity_birds = null');
  const noDrv = (await act(c, ID.admin, 'select * from public.admin_quote_candidates($1)', [req.quote_id])).find((r) => r.supplier_id === ID.s1);
  assert.ok(noDrv.reasons.includes('no_driver'));
  // Only admins can ask.
  assert.equal((await actTry(c, ID.buyer, 'select * from public.admin_quote_candidates($1)', [req.quote_id])).error?.code, '42501');
  assert.equal((await actTry(c, ID.s4, 'select * from public.admin_quote_candidates($1)', [req.quote_id])).error?.code, '42501');
});

test('pricing a requested quote sends it back: the buyer gets a quote document and a notification, a re-price replaces it', async () => {
  const req = await requestQuote(400);
  assert.equal(req.kind, 'requested');
  // Nothing for the buyer to open until it is priced.
  assert.equal((await sql(`select 1 from public.billing_documents where quote_id = $1`, [req.quote_id])).length, 0);
  assert.equal((await sql(`select 1 from public.notifications where template = 'quote_ready'`)).length, 0);

  const price = (birds1, birds2) => act(c, ID.admin, 'select public.admin_price_quote($1, $2::jsonb)', [req.quote_id,
    JSON.stringify([{ supplier_id: ID.s4, birds: birds1, price_cents: 9000 }, { supplier_id: ID.s2, birds: birds2, price_cents: 7000 }])]);
  await price(200, 200);

  // The buyer can read their own quote document, and sees the quote in buyer_quotes with a price.
  const docs = await act(c, ID.buyer, `select number, amount_cents from public.billing_documents where quote_id = $1 and kind = 'quote'`, [req.quote_id]);
  assert.equal(docs.length, 1);
  const q1 = await one('select total_cents from public.quotes where id = $1', [req.quote_id]);
  assert.equal(docs[0].amount_cents, q1.total_cents);
  const [view] = await act(c, ID.buyer, 'select total_cents, status, kind from public.buyer_quotes where id = $1', [req.quote_id]);
  assert.deepEqual([view.status, view.kind], ['open', 'requested']);
  assert.ok(view.total_cents > 0);

  // One notification is queued for the buyer, with no supplier detail in it.
  const notes = await sql(`select profile_id, channel, payload from public.notifications where template = 'quote_ready'`);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].profile_id, ID.buyer);
  assert.equal(notes[0].payload.quote_id, req.quote_id);
  assert.ok(!JSON.stringify(notes[0].payload).includes(ID.s4));

  // Another buyer cannot see the document.
  assert.equal((await act(c, ID.buyer2, `select 1 from public.billing_documents where quote_id = $1`, [req.quote_id])).length, 0);

  // Re-pricing replaces the document with the new amount rather than leaving a stale one.
  await price(300, 100);
  const after = await sql(`select amount_cents from public.billing_documents where quote_id = $1 and kind = 'quote'`, [req.quote_id]);
  const q2 = await one('select total_cents from public.quotes where id = $1', [req.quote_id]);
  assert.equal(after.length, 1);
  assert.equal(after[0].amount_cents, q2.total_cents);
});

test('a short pickup: the supplier is paid for what was collected, the driver cannot deliver more than that', async () => {
  const quote = await requestQuote(50);
  const { order, code } = await placeAndPay(quote);
  const trip = await one(`select t.id from public.trips t join public.allocations a on a.id = t.allocation_id where a.order_id = $1`, [order.id]);
  const slot = await one(`insert into public.delivery_slots (label, start_time, end_time) values ('Morning', '08:00', '12:00') returning id`);
  await act(c, ID.admin, `select public.admin_schedule_order($1, current_date + 1, $2)`, [order.id, slot.id]);
  await act(c, ID.admin, 'select public.admin_assign_driver($1, $2)', [trip.id, ID.driver]);

  await act(c, ID.driver, 'select public.driver_confirm_pickup($1, 40)', [trip.id]);
  // the supplier is queued for 40 birds, not the 50 ordered
  const sup = await one(`select amount_cents from public.transfers where party_type = 'supplier'`);
  assert.equal(sup.amount_cents, 9000 * 40);

  // 50 delivered out of 40 collected is refused, and nothing changes
  const over = await actTry(c, ID.driver, 'select public.driver_confirm_delivery($1, $2, 50)', [trip.id, code]);
  assert.match(over.error.message, /delivered_more_than_collected/);
  assert.equal((await one('select status from public.trips where id = $1', [trip.id])).status, 'picked_up');
  assert.equal((await sql(`select 1 from public.transfers where party_type = 'driver'`)).length, 0);

  await act(c, ID.driver, 'select public.driver_confirm_delivery($1, $2, 40)', [trip.id, code]);
  assert.equal((await one('select delivered_count from public.trips where id = $1', [trip.id])).delivered_count, 40);
  // the short load is on record for the admin
  const audit = await sql(`select after from public.audit_log where action = 'order.short_load' and entity_id = $1`, [order.id]);
  assert.equal(audit.length, 1);
  assert.deepEqual([audit[0].after.ordered, audit[0].after.collected], [50, 40]);
});
