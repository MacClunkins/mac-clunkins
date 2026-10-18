// The privacy boundary, proved against the database.
//
// One test per numbered case in the Phase 1 spec, step 9. Each asserts the NEGATIVE:
// the role gets zero rows (or is refused outright), not a filtered screen.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  connect, asRole, assertNoData, assertColumnUnreachable, assertColumnAbsent,
  USERS, FIXTURES, ALL_TABLES, PUBLIC_TABLES,
} from './helpers.mjs';

let db;
before(async () => { db = await connect(); });
after(async () => { await db.end(); });

// ---------------------------------------------------------------------------
// 1. Supplier querying a buyer's orders, addresses and profile -> 0 rows
// ---------------------------------------------------------------------------

describe('1. a supplier cannot reach a buyer they are not connected to', () => {
  test('orders', async () => {
    await asRole(db, USERS.supplier, async ({ tryQ }) => {
      await assertNoData(tryQ, 'select * from public.orders', [], 'supplier -> all orders');
      // Not even the order their own allocation hangs off.
      await assertNoData(
        tryQ, 'select * from public.orders where id = $1', [FIXTURES.buyerOrder],
        'supplier -> the order behind their own allocation',
      );
    });
  });

  test('addresses', async () => {
    await asRole(db, USERS.supplier, async ({ tryQ }) => {
      await assertNoData(tryQ, 'select * from public.addresses', [], 'supplier -> all addresses');
      await assertNoData(
        tryQ, 'select * from public.addresses where id = $1', [FIXTURES.buyerAddress],
        "supplier -> the buyer's delivery address",
      );
    });
  });

  test('profiles', async () => {
    await asRole(db, USERS.supplier, async ({ q, tryQ }) => {
      await assertNoData(
        tryQ, 'select * from public.profiles where id <> $1', [USERS.supplier],
        'supplier -> anyone else’s profile',
      );
      // Own row is still readable — the boundary is other people, not themselves.
      const own = await q('select id, role from public.profiles');
      assert.equal(own.length, 1);
      assert.equal(own[0].id, USERS.supplier);
    });
  });

  test('buyer contact details specifically', async () => {
    await asRole(db, USERS.supplier, async ({ tryQ }) => {
      await assertNoData(
        tryQ,
        'select full_name, whatsapp_phone, business_name from public.profiles where role = $1',
        ['buyer'],
        'supplier -> buyer names and phone numbers',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Supplier querying buyer-facing price fields -> not reachable
// ---------------------------------------------------------------------------

describe('2. a supplier cannot reach buyer-facing prices', () => {
  test('order money columns return nothing', async () => {
    await asRole(db, USERS.supplier, async ({ tryQ }) => {
      await assertNoData(
        tryQ,
        'select bird_price_cents, delivery_fee_cents, service_fee_cents, total_cents from public.orders',
        [], 'supplier -> order money',
      );
    });
  });

  test('quote money columns return nothing', async () => {
    await asRole(db, USERS.supplier, async ({ tryQ }) => {
      await assertNoData(
        tryQ, 'select bird_price_cents, total_cents from public.quotes', [],
        'supplier -> quote money',
      );
    });
  });

  test('the delivery fee is not selectable from trips', async () => {
    await asRole(db, USERS.supplier, async ({ tryQ }) => {
      await assertColumnAbsent(tryQ, 'trips', 'delivery_fee_cents', 'supplier');
    });
  });

  test('the admin view does not leak to a supplier', async () => {
    await asRole(db, USERS.supplier, async ({ tryQ }) => {
      await assertNoData(tryQ, 'select * from public.admin_quotes', [], 'supplier -> admin_quotes');
      await assertNoData(tryQ, 'select * from public.admin_trips', [], 'supplier -> admin_trips');
    });
  });

  test('a supplier does see their own agreed price', async () => {
    await asRole(db, USERS.supplier, async ({ q }) => {
      const rows = await q('select supplier_price_cents, quantity from public.allocations');
      assert.equal(rows.length, 1, 'supplier should see exactly their own allocation');
      assert.equal(rows[0].supplier_price_cents, 7500);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Buyer querying supplier_prices, supplier_details, allocations -> 0 rows
// ---------------------------------------------------------------------------

describe('3. a buyer cannot reach suppliers', () => {
  test('supplier_prices', async () => {
    await asRole(db, USERS.buyer, async ({ tryQ }) => {
      await assertNoData(tryQ, 'select * from public.supplier_prices', [], 'buyer -> supplier_prices');
      await assertNoData(
        tryQ, 'select price_cents from public.supplier_prices', [],
        'buyer -> supplier price_cents',
      );
    });
  });

  test('supplier_details', async () => {
    await asRole(db, USERS.buyer, async ({ tryQ }) => {
      await assertNoData(tryQ, 'select * from public.supplier_details', [], 'buyer -> supplier_details');
      await assertNoData(
        tryQ, 'select farm_name, pickup_address, location from public.supplier_details', [],
        'buyer -> farm identity and location',
      );
    });
  });

  test('allocations', async () => {
    await asRole(db, USERS.buyer, async ({ tryQ }) => {
      await assertNoData(tryQ, 'select * from public.allocations', [], 'buyer -> allocations');
      await assertNoData(
        tryQ, 'select * from public.allocations where order_id = $1', [FIXTURES.buyerOrder],
        'buyer -> the allocations on their own order',
      );
    });
  });

  test('the supplier price on their own quote is not selectable', async () => {
    await asRole(db, USERS.buyer, async ({ tryQ, q }) => {
      // Column-level grant: these three columns do not exist for `authenticated`.
      await assertColumnAbsent(tryQ, 'quotes', 'supplier_price_cents', 'buyer');
      await assertColumnAbsent(tryQ, 'quotes', 'matched_supplier_id', 'buyer');
      await assertColumnAbsent(tryQ, 'quotes', 'distance_km', 'buyer');
      // The rest of their own quote is theirs to read.
      const rows = await q('select id, total_cents from public.buyer_quotes');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].total_cents, 498508);
    });
  });

  test('trips and driver details', async () => {
    await asRole(db, USERS.buyer, async ({ tryQ }) => {
      await assertNoData(tryQ, 'select * from public.trips', [], 'buyer -> trips');
      await assertNoData(tryQ, 'select * from public.driver_details', [], 'buyer -> driver_details');
      await assertNoData(tryQ, 'select * from public.stock', [], 'buyer -> stock');
      await assertNoData(tryQ, 'select * from public.supplier_requirements', [], 'buyer -> requirements');
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Buyer querying another buyer's orders -> 0 rows
// ---------------------------------------------------------------------------

describe('4. a buyer cannot reach another buyer', () => {
  test('orders', async () => {
    await asRole(db, USERS.buyer, async ({ q, tryQ }) => {
      await assertNoData(
        tryQ, 'select * from public.orders where id = $1', [FIXTURES.otherBuyerOrder],
        "buyer -> another buyer's order",
      );
      const mine = await q('select id, number from public.orders');
      assert.equal(mine.length, 1, 'buyer should see exactly their own order');
      assert.equal(mine[0].id, FIXTURES.buyerOrder);
    });
  });

  test('addresses, payments, order events and profile', async () => {
    await asRole(db, USERS.buyer, async ({ tryQ }) => {
      await assertNoData(
        tryQ, 'select * from public.addresses where id = $1', [FIXTURES.otherAddress],
        "buyer -> another buyer's address",
      );
      await assertNoData(
        tryQ, 'select * from public.payments where order_id = $1', [FIXTURES.otherBuyerOrder],
        "buyer -> another buyer's payment",
      );
      await assertNoData(
        tryQ, 'select * from public.order_events where order_id = $1', [FIXTURES.otherBuyerOrder],
        "buyer -> another buyer's order events",
      );
      await assertNoData(
        tryQ, 'select * from public.profiles where id = $1', [USERS.otherBuyer],
        "buyer -> another buyer's profile",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Driver sees only their own trips and the addresses on those trips
// ---------------------------------------------------------------------------

describe('5. a driver sees only their own trip and its addresses', () => {
  test('their own trip, and nothing else on trips', async () => {
    await asRole(db, USERS.driver, async ({ q }) => {
      const rows = await q('select id, driver_share_cents from public.driver_trips');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, FIXTURES.trip);
      assert.equal(rows[0].driver_share_cents, 42840);
    });
  });

  test('the delivery address on that trip is readable, and no other address is', async () => {
    await asRole(db, USERS.driver, async ({ q, tryQ }) => {
      const rows = await q('select id, street, town from public.addresses');
      assert.equal(rows.length, 1, 'driver should see exactly the one address on their trip');
      assert.equal(rows[0].id, FIXTURES.buyerAddress);

      await assertNoData(
        tryQ, 'select * from public.addresses where id = $1', [FIXTURES.otherAddress],
        'driver -> an address not on their trip',
      );
    });
  });

  test('everything else about the order is closed', async () => {
    await asRole(db, USERS.driver, async ({ tryQ }) => {
      await assertNoData(tryQ, 'select * from public.orders', [], 'driver -> orders');
      await assertNoData(tryQ, 'select * from public.allocations', [], 'driver -> allocations');
      await assertNoData(tryQ, 'select * from public.quotes', [], 'driver -> quotes');
      await assertNoData(tryQ, 'select * from public.payments', [], 'driver -> payments');
      await assertNoData(tryQ, 'select * from public.supplier_prices', [], 'driver -> supplier_prices');
      await assertNoData(tryQ, 'select * from public.supplier_details', [], 'driver -> supplier_details');
      await assertNoData(
        tryQ, 'select * from public.profiles where id <> $1', [USERS.driver],
        'driver -> other profiles',
      );
    });
  });

  test('the assigned supplier’s requirements are readable — the driver has to meet them', async () => {
    await asRole(db, USERS.driver, async ({ q }) => {
      const rows = await q('select supplier_id, max_per_crate from public.supplier_requirements');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].supplier_id, USERS.supplier);
    });
  });
});

// ---------------------------------------------------------------------------
// 6. Driver cannot reach bird_price_cents, supplier_price_cents, service_fee_cents
// ---------------------------------------------------------------------------

describe('6. a driver sees no price but their own fee', () => {
  test('order and quote prices are unreachable', async () => {
    await asRole(db, USERS.driver, async ({ tryQ }) => {
      await assertNoData(
        tryQ, 'select bird_price_cents, service_fee_cents from public.orders', [],
        'driver -> order prices',
      );
      await assertNoData(
        tryQ, 'select bird_price_cents, service_fee_cents from public.quotes', [],
        'driver -> quote prices',
      );
      await assertNoData(
        tryQ, 'select supplier_price_cents from public.allocations', [],
        'driver -> supplier price',
      );
    });
  });

  test('the full delivery fee is not a selectable column at all', async () => {
    await asRole(db, USERS.driver, async ({ tryQ }) => {
      await assertColumnAbsent(tryQ, 'trips', 'delivery_fee_cents', 'driver');
      await assertColumnAbsent(tryQ, 'quotes', 'supplier_price_cents', 'driver');
      await assertColumnAbsent(tryQ, 'allocations', 'distance_km', 'driver');
    });
  });

  test('the admin trip view gives a driver nothing', async () => {
    await asRole(db, USERS.driver, async ({ tryQ }) => {
      await assertNoData(tryQ, 'select * from public.admin_trips', [], 'driver -> admin_trips');
    });
  });

  test('the pricing settings are not readable', async () => {
    await asRole(db, USERS.driver, async ({ tryQ }) => {
      await assertNoData(
        tryQ,
        `select key from public.settings
         where key in ('markup_pct','min_margin_cents','driver_share_pct','delivery_per_km_cents')`,
        [], 'driver -> pricing settings',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Pending supplier / pending driver -> no job or trip data at all
// ---------------------------------------------------------------------------

describe('7. a pending account reaches no job or trip data', () => {
  for (const [label, uid] of [['supplier', USERS.pendingSupplier], ['driver', USERS.pendingDriver]]) {
    test(`pending ${label}`, async () => {
      await asRole(db, uid, async ({ q, tryQ }) => {
        for (const table of [
          'orders', 'allocations', 'trips', 'quotes', 'payments', 'transfers',
          'supplier_prices', 'stock', 'addresses', 'audit_log', 'pdma_reports',
        ]) {
          await assertNoData(tryQ, `select * from public.${table}`, [], `pending ${label} -> ${table}`);
        }
        await assertNoData(
          tryQ, 'select * from public.profiles where id <> $1', [uid],
          `pending ${label} -> other profiles`,
        );

        // They can still read their own row, which is what /pending renders.
        const own = await q('select id, status from public.profiles');
        assert.equal(own.length, 1);
        assert.equal(own[0].status, 'pending');
      });
    });
  }

  test('a pending supplier cannot activate themselves', async () => {
    await asRole(db, USERS.pendingSupplier, async ({ tryQ }) => {
      for (const sql of [
        `update public.profiles set status = 'active' where id = '${USERS.pendingSupplier}'`,
        `update public.profiles set role = 'admin' where id = '${USERS.pendingSupplier}'`,
      ]) {
        const r = await tryQ(sql);
        assert.equal(r.ok, false, `self-activation must be refused: ${sql}`);
        assert.equal(r.error.code, '42501', `expected 42501, got ${r.error.code}: ${r.error.message}`);
      }
    });
  });

  test('a pending supplier cannot call the approval function', async () => {
    await asRole(db, USERS.pendingSupplier, async ({ tryQ }) => {
      const r = await tryQ(
        `select public.set_profile_status($1, 'active')`, [USERS.pendingSupplier],
      );
      assert.equal(r.ok, false, 'set_profile_status must refuse a non-admin');
      assert.equal(r.error.code, '42501');
    });
  });
});

// ---------------------------------------------------------------------------
// 8. Anonymous -> only provinces, delivery_slots, areas_served, public settings
// ---------------------------------------------------------------------------

describe('8. anonymous reads only the public reference data', () => {
  test('the three public tables are readable', async () => {
    await asRole(db, null, async ({ q }) => {
      assert.equal((await q('select * from public.provinces')).length, 9);
      assert.ok((await q('select * from public.delivery_slots')).length >= 3);
      assert.equal((await q('select * from public.areas_served')).length, 9);
    });
  });

  test('settings: public keys only', async () => {
    await asRole(db, null, async ({ q, tryQ }) => {
      const keys = (await q('select key from public.settings order by key')).map((r) => r.key);
      assert.deepEqual(keys, [
        'delivery_timeline', 'issue_window_hours', 'min_order', 'payments_mode',
        'privacy_notice_effective_date', 'quote_hold_minutes',
        'rfq_max_km', 'rfq_min_birds', 'rfq_quote_hours', 'support_phone', 'terms_effective_date', 'unpaid_cancel_hours',
      ]);
      for (const secret of ['markup_pct', 'min_margin_cents', 'service_fee_pct', 'driver_share_pct']) {
        await assertNoData(
          tryQ, 'select * from public.settings where key = $1', [secret],
          `anon -> settings.${secret}`,
        );
      }
      // updated_by would identify an admin, so it is not even a column for a client.
      await assertColumnUnreachable(tryQ, 'settings', 'updated_by', 'anon');
    });
  });

  test('every one of the other 27 tables yields nothing', async () => {
    const outcomes = {};
    await asRole(db, null, async ({ tryQ }) => {
      for (const table of ALL_TABLES) {
        if (PUBLIC_TABLES.includes(table) || table === 'settings') continue;
        outcomes[table] = await assertNoData(tryQ, `select * from public.${table}`, [], `anon -> ${table}`);
      }
    });
    assert.equal(Object.keys(outcomes).length, 27, 'all 27 non-public tables must be checked');
  });

  test('anonymous cannot create a profile or write anything', async () => {
    await asRole(db, null, async ({ tryQ }) => {
      const insert = await tryQ(
        `insert into public.profiles (id, role, status, full_name)
         values (gen_random_uuid(), 'admin', 'active', 'Intruder')`,
      );
      assert.equal(insert.ok, false, 'anon must not be able to insert a profile');
      const settings = await tryQ(`update public.settings set value = '0' where key = 'markup_pct'`);
      assert.equal(settings.ok, false, 'anon must not be able to write settings');
    });
  });
});

// ---------------------------------------------------------------------------
// 9. Admin reads everything
// ---------------------------------------------------------------------------

describe('9. an admin reads everything', () => {
  test('all seven profiles, both orders, the allocation and the trip', async () => {
    await asRole(db, USERS.admin, async ({ q }) => {
      assert.equal((await q('select * from public.profiles')).length, 7);
      assert.equal((await q('select * from public.orders')).length, 2);
      assert.equal((await q('select * from public.addresses')).length, 2);
      assert.equal((await q('select * from public.supplier_prices')).length, 4);
      assert.equal((await q('select * from public.supplier_details')).length, 2);
      assert.equal((await q('select * from public.payments')).length, 2);
      assert.equal((await q('select key from public.settings')).length, 32);
      // The three column-restricted tables: every row, read through the admin view.
      assert.equal((await q('select * from public.admin_allocations')).length, 1);
      assert.equal((await q('select * from public.admin_trips')).length, 1);
      assert.equal((await q('select * from public.admin_quotes')).length, 1);
    });
  });

  test('an admin reads the withheld columns only through the admin view, never the base table', async () => {
    // This is the cost of the design and it is deliberate: in Supabase every signed-in
    // user shares the `authenticated` database role, so the column grant that hides
    // supplier prices from a buyer necessarily hides them from an admin too. The admin
    // route is the owner-privileged view, guarded by is_admin().
    await asRole(db, USERS.admin, async ({ tryQ }) => {
      await assertColumnAbsent(tryQ, 'allocations', 'distance_km', 'admin (base table)');
      await assertColumnAbsent(tryQ, 'trips', 'delivery_fee_cents', 'admin (base table)');
      await assertColumnAbsent(tryQ, 'quotes', 'supplier_price_cents', 'admin (base table)');
      await assertColumnUnreachable(tryQ, 'settings', 'updated_by', 'admin (base table)');
    });
  });

  test('the withheld columns are reachable through the admin views', async () => {
    await asRole(db, USERS.admin, async ({ q }) => {
      const [quote] = await q(
        'select supplier_price_cents, matched_supplier_id, distance_km from public.admin_quotes',
      );
      assert.equal(quote.supplier_price_cents, 7500);
      assert.equal(quote.matched_supplier_id, USERS.supplier);

      const [trip] = await q('select delivery_fee_cents, driver_share_cents from public.admin_trips');
      assert.equal(trip.delivery_fee_cents, 50400);
      assert.equal(trip.driver_share_cents, 42840);

      const [alloc] = await q('select distance_km from public.admin_allocations');
      assert.equal(Number(alloc.distance_km), 38);
    });
  });

  test('the cost tables return rows to an admin and nothing to a buyer, supplier or driver', async () => {
    for (const t of ['quote_costs', 'allocation_costs', 'trip_costs']) {
      await asRole(db, USERS.admin, async ({ q }) => {
        assert.ok((await q(`select * from public.${t}`)).length > 0, `admin sees ${t}`);
      });
      for (const who of ['buyer', 'supplier', 'driver']) {
        await asRole(db, USERS[who], async ({ tryQ }) => {
          await assertNoData(tryQ, `select * from public.${t}`, [], `${who} -> ${t}`);
        });
      }
    }
  });

  test('the admin-only tables are readable by an admin and no one else', async () => {
    await asRole(db, USERS.admin, async ({ q }) => {
      await q('select * from public.audit_log');
      await q('select * from public.pdma_reports');
    });
    for (const [label, uid] of [
      ['buyer', USERS.buyer], ['supplier', USERS.supplier], ['driver', USERS.driver],
    ]) {
      await asRole(db, uid, async ({ tryQ }) => {
        await assertNoData(tryQ, 'select * from public.audit_log', [], `${label} -> audit_log`);
        await assertNoData(tryQ, 'select * from public.pdma_reports', [], `${label} -> pdma_reports`);
      });
    }
  });

  test('a suspended admin is not an admin', async () => {
    await db.query('begin');
    try {
      await db.query(`update public.profiles set status = 'suspended' where id = $1`, [USERS.admin]);
      await asRole(db, USERS.admin, async ({ tryQ }) => {
        await assertNoData(tryQ, 'select * from public.audit_log', [], 'suspended admin -> audit_log');
        await assertNoData(
          tryQ, 'select * from public.orders where buyer_id <> $1', [USERS.admin],
          'suspended admin -> orders',
        );
      }, { nested: true });
    } finally {
      await db.query('rollback');
    }
  });
});

// ---------------------------------------------------------------------------
// 10. consents — append-only; owner reads own rows, admin reads all, nobody writes
// ---------------------------------------------------------------------------

describe('10. consents — append-only, own rows + admin only', () => {
  test('the signup trigger wrote the expected rows for a self-registered account', async () => {
    await asRole(db, USERS.buyer, async ({ q }) => {
      const rows = await q(
        'select consent_type, document_version, granted, source from public.consents order by consent_type',
      );
      assert.deepEqual(
        rows.map((r) => r.consent_type).sort(),
        ['cross_border_transfer', 'marketing_messaging', 'privacy_notice', 'service_messaging', 'terms'],
      );
      for (const row of rows) {
        assert.equal(row.source, 'signup', `${row.consent_type} should come from signup`);
        assert.ok(
          row.document_version === 'terms_v1' || row.document_version === 'privacy_notice_v1',
          `${row.consent_type} has an unexpected document_version: ${row.document_version}`,
        );
        if (row.consent_type === 'marketing_messaging') {
          assert.equal(row.granted, false, 'seed data never opts in to marketing');
        } else {
          assert.equal(row.granted, true, `${row.consent_type} must be granted at signup`);
        }
      }
    });
  });

  test('a role cannot read another account’s consent rows', async () => {
    await asRole(db, USERS.supplier, async ({ tryQ }) => {
      await assertNoData(
        tryQ, 'select * from public.consents where profile_id = $1', [USERS.buyer],
        "supplier -> buyer's consents",
      );
    });
    await asRole(db, USERS.buyer, async ({ tryQ }) => {
      await assertNoData(
        tryQ, 'select * from public.consents where profile_id = $1', [USERS.otherBuyer],
        "buyer -> another buyer's consents",
      );
    });
  });

  test('no role may update a consent row, including the owner and an admin', async () => {
    for (const [label, uid] of [['owner', USERS.buyer], ['admin', USERS.admin]]) {
      await asRole(db, uid, async ({ tryQ }) => {
        const result = await tryQ(
          "update public.consents set granted = false where profile_id = $1 and consent_type = 'terms'",
          [USERS.buyer],
        );
        assert.equal(result.ok, false, `${label} must not be able to update a consent row`);
        assert.equal(result.error.code, '42501');
      });
    }
  });

  test('no role may delete a consent row, including the owner and an admin', async () => {
    for (const [label, uid] of [['owner', USERS.buyer], ['admin', USERS.admin]]) {
      await asRole(db, uid, async ({ tryQ }) => {
        const result = await tryQ(
          "delete from public.consents where profile_id = $1 and consent_type = 'terms'",
          [USERS.buyer],
        );
        assert.equal(result.ok, false, `${label} must not be able to delete a consent row`);
        assert.equal(result.error.code, '42501');
      });
    }
  });

  test('an admin reads every account’s consent rows', async () => {
    await asRole(db, USERS.admin, async ({ q }) => {
      const rows = await q('select profile_id from public.consents');
      // Six self-registered seed accounts x five consent types each. The admin account
      // is inserted with the signup trigger disabled on purpose, so it holds none.
      assert.equal(rows.length, 30);
      const distinctProfiles = new Set(rows.map((r) => r.profile_id));
      assert.equal(distinctProfiles.size, 6);
      assert.ok(!distinctProfiles.has(USERS.admin));
    });
  });
});
