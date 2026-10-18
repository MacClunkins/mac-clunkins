// The security rules are wrapped so the signed-in user is looked up once per query, and the rewrite changed no
// meaning (the RLS privacy suite runs against the same database and must still pass).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../rls/helpers.mjs';

let c;
before(async () => { c = await connect(); });
after(async () => { await c.end(); });

const sql = async (q, p = []) => (await c.query(q, p)).rows;

// Remove every already-wrapped call, then see whether a bare one is left.
const stripWrapped = (e) => e
  .replace(/\(\s*select\s+(public\.)?(auth\.uid\(\)|is_admin\(\)|is_active_role\([^()]*\))(\s+as\s+\w+)?\s*\)/gi, '')
  .replace(/\(\s*select\s+auth\.uid\(\)\s*\)/gi, '');

test('no policy in public calls auth.uid(), is_admin() or is_active_role() once per row', async () => {
  const rows = await sql(`select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public'`);
  assert.ok(rows.length > 40, 'the policies exist');
  const bare = [];
  for (const r of rows) {
    for (const e of [r.qual, r.with_check]) {
      if (e && /(auth\.uid\(\)|is_admin\(\)|is_active_role\()/i.test(stripWrapped(e))) bare.push(`${r.tablename}.${r.policyname}`);
    }
  }
  assert.deepEqual([...new Set(bare)], []);
});

test('the foreign keys the advisor flagged are indexed', async () => {
  const idx = (await sql(`select indexname from pg_indexes where schemaname = 'public' and indexname in ('consents_superseded_by_idx', 'quote_costs_matched_supplier_id_idx')`)).map((r) => r.indexname).sort();
  assert.deepEqual(idx, ['consents_superseded_by_idx', 'quote_costs_matched_supplier_id_idx']);
});
