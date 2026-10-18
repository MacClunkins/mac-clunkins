// Test harness for the RLS suite.
//
// Every assertion in this suite is a real SQL query run as a real database role with a
// real JWT claim set, against the real policies. Nothing here asserts on rendered UI,
// and nothing here uses a service-role connection to peek around a policy.
//
// How impersonation works: PostgREST, when it serves a request, sets
// `request.jwt.claims` on the session and then `SET LOCAL ROLE` to the role in the JWT.
// `asRole()` does exactly those two things inside a transaction that is always rolled
// back, so tests cannot leak state into each other.

import { Client } from 'pg';
import assert from 'node:assert/strict';

export const DB = {
  host: process.env.PGHOST ?? `/tmp/mccluckins-pg-${process.getuid()}`,
  port: Number(process.env.PGPORT ?? 54329),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.PGDATABASE ?? 'postgres',
};

/** The seeded accounts. Ids are fixed in supabase/seed.sql. */
export const USERS = {
  admin:           '11111111-1111-4111-8111-111111111111',
  buyer:           '22222222-2222-4222-8222-222222222222',
  otherBuyer:      '2b2b2b2b-2222-4222-8222-2b2b2b2b2b2b',
  supplier:        '33333333-3333-4333-8333-333333333333',
  driver:          '44444444-4444-4444-8444-444444444444',
  pendingSupplier: '55555555-5555-4555-8555-555555555555',
  pendingDriver:   '66666666-6666-4666-8666-666666666666',
};

/** Seeded rows the tests reach for by id. */
export const FIXTURES = {
  buyerOrder:      'ddddddd1-0000-4000-8000-000000000001',
  otherBuyerOrder: 'ddddddd1-0000-4000-8000-000000000002',
  buyerAddress:    'bbbbbbb1-0000-4000-8000-000000000001',
  otherAddress:    'bbbbbbb1-0000-4000-8000-000000000002',
  quote:           'ccccccc1-0000-4000-8000-000000000001',
  allocation:      'eeeeeee1-0000-4000-8000-000000000001',
  trip:            'fffffff1-0000-4000-8000-000000000001',
};

/** The 26 tables, so the anonymous sweep cannot silently skip one. */
export const ALL_TABLES = [
  'profiles', 'addresses', 'provinces', 'supplier_details', 'supplier_prices',
  'supplier_requirements', 'stock', 'driver_details', 'documents', 'delivery_slots',
  'quotes', 'orders', 'allocations', 'trips', 'payments', 'transfers', 'refunds',
  'cases', 'case_events', 'ratings', 'order_events', 'pdma_reports', 'notifications',
  'audit_log', 'settings', 'areas_served', 'consents', 'quote_costs', 'allocation_costs', 'trip_costs',
];

export const PUBLIC_TABLES = ['provinces', 'delivery_slots', 'areas_served'];

export async function connect() {
  const client = new Client(DB);
  await client.connect();
  return client;
}

/**
 * Run `fn` as a signed-in user (or as `anon` when uid is null), then roll back.
 * `fn` receives a `q(sql, params)` that returns rows, and a `tryQ` that captures the
 * error instead of throwing so a privilege refusal can be asserted on.
 */
export async function asRole(client, uid, fn, { dbRole = uid ? 'authenticated' : 'anon', nested = false } = {}) {
  // `nested` is for a test that has already opened a transaction to stage a fixture:
  // a savepoint scopes the role switch without discarding that staging.
  const open = nested ? 'savepoint as_role' : 'begin';
  const close = nested ? 'rollback to savepoint as_role' : 'rollback';
  await client.query(open);
  try {
    const claims = uid
      ? JSON.stringify({ sub: uid, role: dbRole, aud: 'authenticated' })
      : JSON.stringify({ role: 'anon', aud: 'anon' });
    // Set the claims before dropping privileges, as PostgREST does.
    await client.query('select set_config($1, $2, true)', ['request.jwt.claims', claims]);
    await client.query(`set local role ${dbRole}`);

    const q = async (sql, params = []) => (await client.query(sql, params)).rows;
    const tryQ = async (sql, params = []) => {
      // A failed statement aborts the transaction, so each attempt gets a savepoint.
      await client.query('savepoint try_q');
      try {
        const rows = (await client.query(sql, params)).rows;
        await client.query('release savepoint try_q');
        return { ok: true, rows, error: null };
      } catch (error) {
        await client.query('rollback to savepoint try_q');
        return { ok: false, rows: [], error };
      }
    };
    return await fn({ q, tryQ });
  } finally {
    await client.query(close);
  }
}

/**
 * The suite's core assertion: this role gets NO DATA from this query.
 *
 * Two outcomes count as no data, and the difference is recorded rather than hidden:
 *   - zero rows: the grant exists, an RLS policy matched nothing. This is the outcome
 *     the spec asks for on the signed-in cases.
 *   - a privilege refusal (42501): the role was never granted the table or column at
 *     all, so the query never reaches RLS. Strictly stronger than zero rows.
 * Anything else — one or more rows — is a failure.
 */
export async function assertNoData(tryQ, sql, params, label) {
  const result = await tryQ(sql, params);
  if (result.ok) {
    assert.equal(
      result.rows.length, 0,
      `${label}: expected 0 rows, got ${result.rows.length} — ${JSON.stringify(result.rows[0])}`,
    );
    return 'zero rows';
  }
  assert.equal(
    result.error.code, '42501',
    `${label}: expected zero rows or a privilege refusal (42501), got ${result.error.code}: ${result.error.message}`,
  );
  return 'privilege refused';
}

/** Asserts a column cannot be selected at all by this role. */
/** The column was moved to an admin-only table, so it no longer exists on the base table. */
export async function assertColumnAbsent(tryQ, table, column, label) {
  const result = await tryQ(`select ${column} from public.${table} limit 1`);
  assert.equal(result.ok, false, `${label}: ${table}.${column} was selectable and must not exist`);
  assert.equal(
    result.error.code, '42703',
    `${label}: expected 42703 (no such column) on ${table}.${column}, got ${result.error.code}: ${result.error.message}`,
  );
}

export async function assertColumnUnreachable(tryQ, table, column, label) {
  const result = await tryQ(`select ${column} from public.${table} limit 1`);
  assert.equal(result.ok, false, `${label}: ${table}.${column} was selectable and must not be`);
  assert.equal(
    result.error.code, '42501',
    `${label}: expected 42501 on ${table}.${column}, got ${result.error.code}: ${result.error.message}`,
  );
}
