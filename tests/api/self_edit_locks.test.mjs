// People can edit their own farm or vehicle details and upload documents, but not the fields only admins decide.
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
const one = async (q, p = []) => (await sql(q, p))[0];

test('a supplier can edit their farm details but not pause, rating, flu zone or payout fields', async () => {
  await act(c, ID.s4, `update public.supplier_details set farm_name = 'New farm name', pickup_address = '1 Farm Rd' where profile_id = $1`, [ID.s4]);
  assert.equal((await one('select farm_name from public.supplier_details where profile_id = $1', [ID.s4])).farm_name, 'New farm name');
  // the onboarding upsert still works
  await act(c, ID.s4, `insert into public.supplier_details (profile_id, farm_name, province) values ($1, 'Upserted', 'GP')
                       on conflict (profile_id) do update set farm_name = excluded.farm_name, province = excluded.province`, [ID.s4]);
  assert.equal((await one('select farm_name from public.supplier_details where profile_id = $1', [ID.s4])).farm_name, 'Upserted');

  for (const col of ['paused = true', `paused_reason = 'x'`, 'rating_avg = 5', `avian_flu_zone = 'none'`, `paystack_recipient_code = 'RCP_other'`, `bank_details_encrypted = 'x'`]) {
    const r = await actTry(c, ID.s4, `update public.supplier_details set ${col} where profile_id = $1`, [ID.s4]);
    assert.equal(r.error?.code, '42501', col);
  }
});

test('a supplier who was paused by an admin cannot unpause themselves', async () => {
  await c.query(`update public.supplier_details set paused = true, paused_reason = 'documents expired' where profile_id = $1`, [ID.s4]);
  const r = await actTry(c, ID.s4, `update public.supplier_details set paused = false, paused_reason = null where profile_id = $1`, [ID.s4]);
  assert.equal(r.error?.code, '42501');
  assert.equal((await one('select paused from public.supplier_details where profile_id = $1', [ID.s4])).paused, true);
});

test('a driver can edit their vehicle but not pause, rating or payout fields', async () => {
  await act(c, ID.driver, `update public.driver_details set vehicle_reg = 'CA 123 456', capacity_birds = 150 where profile_id = $1`, [ID.driver]);
  const row = await one('select vehicle_reg, capacity_birds from public.driver_details where profile_id = $1', [ID.driver]);
  assert.deepEqual([row.vehicle_reg, row.capacity_birds], ['CA 123 456', 150]);
  for (const col of ['paused = false', 'rating_avg = 5', `paystack_recipient_code = 'RCP_other'`, `bank_details_encrypted = 'x'`]) {
    const r = await actTry(c, ID.driver, `update public.driver_details set ${col} where profile_id = $1`, [ID.driver]);
    assert.equal(r.error?.code, '42501', col);
  }
});

test('documents: no direct writes, submit_document always starts at uploaded and re-enters review', async () => {
  const direct = await actTry(c, ID.s4, `insert into public.documents (profile_id, kind, status) values ($1, 'pdma', 'approved')`, [ID.s4]);
  assert.equal(direct.error?.code, '42501');
  assert.equal((await actTry(c, ID.s4, `update public.documents set file_path = 'x' where profile_id = $1`, [ID.s4])).error?.code, '42501');

  const [{ id }] = await act(c, ID.s4, `select public.submit_document('ncd_ai_evidence', $1, '2027-01-31') as id`, [`${ID.s4}/docs/a.pdf`]);
  let doc = await one('select status, file_path, expires_on::text, reviewed_by from public.documents where id = $1', [id]);
  assert.deepEqual([doc.status, doc.file_path, doc.expires_on, doc.reviewed_by], ['uploaded', `${ID.s4}/docs/a.pdf`, '2027-01-31', null]);

  // an admin approves it, the supplier uploads a renewed one: same document, back to uploaded, verdict cleared
  await c.query(`update public.documents set status = 'approved', reviewed_by = $2, reviewed_at = now(), notes = 'ok' where id = $1`, [id, ID.admin]);
  const [{ id: again }] = await act(c, ID.s4, `select public.submit_document('ncd_ai_evidence', $1, '2028-01-31') as id`, [`${ID.s4}/docs/b.pdf`]);
  assert.equal(again, id);
  doc = await one('select status, file_path, expires_on::text, reviewed_by, notes from public.documents where id = $1', [id]);
  assert.deepEqual([doc.status, doc.file_path, doc.expires_on, doc.reviewed_by, doc.notes], ['uploaded', `${ID.s4}/docs/b.pdf`, '2028-01-31', null, null]);
  assert.ok((await sql(`select 1 from public.audit_log where action = 'document.submitted' and entity_id = $1`, [id])).length >= 2);

  // not a file that belongs to someone else, not a buyer or an admin, not a made-up kind
  assert.equal((await actTry(c, ID.s4, `select public.submit_document('pdma', $1)`, [`${ID.s1}/docs/a.pdf`])).error?.code, '22023');
  assert.equal((await actTry(c, ID.buyer, `select public.submit_document('pdma', $1)`, [`${ID.buyer}/docs/a.pdf`])).error?.code, '42501');
  assert.equal((await actTry(c, ID.admin, `select public.submit_document('pdma', $1)`, [`${ID.admin}/docs/a.pdf`])).error?.code, '42501');
  assert.ok((await actTry(c, ID.s4, `select public.submit_document('not_a_kind', $1)`, [`${ID.s4}/docs/a.pdf`])).error);
  // other people cannot read it, and the admin review path still works
  assert.equal((await act(c, ID.s1, 'select id from public.documents where id = $1', [id])).length, 0);
});

test('a driver submits documents the same way', async () => {
  const [{ id }] = await act(c, ID.driver, `select public.submit_document('licence', $1, null) as id`, [`${ID.driver}/docs/licence.pdf`]);
  assert.equal((await one('select status from public.documents where id = $1', [id])).status, 'uploaded');
});
