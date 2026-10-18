-- McCluckin's — seed data.
--
-- Enough to log in as every role and to prove the RLS boundary in both directions.
-- Not a history: Phase 2's ordering work brings real volume.
--
-- The buyer, supplier and driver accounts are created by inserting into auth.users and
-- letting the real signup trigger build their profile, so the seed exercises the same
-- path a browser signup does — including landing on `pending`. They are then approved
-- the way an admin would approve them. The admin account is the one exception: admins
-- are never self-signup, so it is inserted with the signup trigger held off, which is
-- exactly the privileged operation it should look like.
--
-- Test passwords are in README.md, not here in a comment and not in any task thread.

begin;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

insert into public.provinces (code, name, active) values
  ('EC',  'Eastern Cape',   true),
  ('FS',  'Free State',     true),
  ('GP',  'Gauteng',        true),
  ('KZN', 'KwaZulu-Natal',  true),
  ('LP',  'Limpopo',        true),
  ('MP',  'Mpumalanga',     true),
  ('NC',  'Northern Cape',  true),
  ('NW',  'North West',     true),
  ('WC',  'Western Cape',   true)
on conflict (code) do nothing;

-- Launch focus is Gauteng then KwaZulu-Natal; the rest are listed but not served yet.
insert into public.areas_served (province, active, launch_order) values
  ('GP',  true,  1),
  ('KZN', true,  2),
  ('WC',  false, 3),
  ('EC',  false, 4),
  ('FS',  false, 5),
  ('MP',  false, 6),
  ('LP',  false, 7),
  ('NW',  false, 8),
  ('NC',  false, 9)
on conflict (province) do nothing;

insert into public.delivery_slots (id, label, start_time, end_time, active) values
  ('aaaaaaa1-0000-4000-8000-000000000001', 'Morning 08:00–11:00',   '08:00', '11:00', true),
  ('aaaaaaa1-0000-4000-8000-000000000002', 'Midday 11:00–14:00',    '11:00', '14:00', true),
  ('aaaaaaa1-0000-4000-8000-000000000003', 'Afternoon 14:00–17:00', '14:00', '17:00', true)
on conflict (id) do nothing;

-- Starting values from the Brief's Pricing and payments table. Money is integer cents;
-- percentages are plain numbers. `is_public` is the allowlist the settings RLS policy
-- reads — anything false is admin-only.
insert into public.settings (key, value, is_public, description) values
  ('markup_pct',             '15'::jsonb,     false, 'Markup added to the supplier price, percent'),
  ('min_margin_cents',       '800'::jsonb,    false, 'Minimum margin per bird, cents (R8)'),
  ('service_fee_pct',        '3.5'::jsonb,    false, 'Service fee on birds + delivery, percent'),
  ('delivery_base_cents',    '15000'::jsonb,  false, 'Delivery base fee, cents (R150)'),
  ('delivery_per_km_cents',  '800'::jsonb,    false, 'Delivery fee per km, cents (R8)'),
  ('delivery_per_bird_cents','100'::jsonb,    false, 'Delivery fee per bird, cents (R1)'),
  ('driver_share_pct',       '85'::jsonb,     false, 'Share of the delivery fee paid to the driver, percent'),
  ('quote_hold_minutes',     '30'::jsonb,     true,  'How long an instant quote is held'),
  ('rfq_min_birds',          '200'::jsonb,    true,  'Above this quantity, quote by request'),
  ('rfq_max_km',             '300'::jsonb,    true,  'Above this distance, quote by request'),
  ('min_order',              '10'::jsonb,     true,  'Minimum order, birds'),
  ('unpaid_cancel_hours',    '24'::jsonb,     true,  'Unpaid orders cancel after this many hours'),
  ('issue_window_hours',     '2'::jsonb,      true,  'Window to report a problem after delivery'),
  ('heat_warn_c',            '30'::jsonb,     true,  'Forecast above this triggers a heat warning, °C'),
  ('journey_warn_hours',     '2'::jsonb,      false, 'Journey longer than this triggers a warning'),
  -- Not decided yet. Stays null; the app must render "not set", never a silent default.
  ('delivery_timeline',      null,            true,  'Delivery promise after payment — NOT DECIDED YET'),
  -- Document versioning (IDE-21 workstream A, G5): a version bump is a data change here,
  -- not a code change. Public because the privacy notice page shows it to anonymous
  -- visitors before they sign up.
  ('privacy_notice_effective_date', '"2026-09-27"'::jsonb, true, 'Effective date of privacy_notice_v1'),
  ('terms_effective_date',          '"2026-09-27"'::jsonb, true, 'Effective date of terms_v1 (draft — see /legal/terms)')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

-- Admin: inserted with the signup trigger held off, because handle_new_user() refuses
-- to mint an admin and should keep refusing.
alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (id, email, phone, encrypted_password, email_confirmed_at, raw_user_meta_data)
values (
  '11111111-1111-4111-8111-111111111111',
  'admin@mccluckins.test', '+27600000001',
  extensions.crypt('McCluckins!Admin1', extensions.gen_salt('bf')),
  now(), '{"full_name":"Thandi Admin","role":"admin"}'::jsonb
) on conflict (id) do nothing;

insert into public.profiles (id, role, status, full_name, business_name, whatsapp_phone, email, language)
values (
  '11111111-1111-4111-8111-111111111111', 'admin', 'active',
  'Thandi Admin', 'McCluckin''s', '+27600000001', 'admin@mccluckins.test', 'en'
) on conflict (id) do nothing;

alter table auth.users enable trigger on_auth_user_created;

-- Everyone else goes through the real signup trigger and lands on `pending`.
insert into auth.users (id, email, phone, encrypted_password, email_confirmed_at, raw_user_meta_data) values
  ('22222222-2222-4222-8222-222222222222', 'buyer@mccluckins.test', '+27600000002',
   extensions.crypt('McCluckins!Buyer1', extensions.gen_salt('bf')), now(),
   '{"role":"buyer","full_name":"Sipho Buyer","business_name":"Sipho''s Shisanyama","business_type":"shisanyama","whatsapp_phone":"+27600000002","pdma_number":"PDMA-2026-0042"}'::jsonb),

  ('2b2b2b2b-2222-4222-8222-2b2b2b2b2b2b', 'buyer2@mccluckins.test', '+27600000003',
   extensions.crypt('McCluckins!Buyer2', extensions.gen_salt('bf')), now(),
   '{"role":"buyer","full_name":"Naledi Buyer","business_name":"Naledi Kota Shop","business_type":"kota_shop","whatsapp_phone":"+27600000003"}'::jsonb),

  ('33333333-3333-4333-8333-333333333333', 'supplier@mccluckins.test', '+27600000004',
   extensions.crypt('McCluckins!Supp1', extensions.gen_salt('bf')), now(),
   '{"role":"supplier","full_name":"Johan Supplier","business_name":"Kopano Poultry","business_type":"farm","whatsapp_phone":"+27600000004"}'::jsonb),

  ('44444444-4444-4444-8444-444444444444', 'driver@mccluckins.test', '+27600000005',
   extensions.crypt('McCluckins!Driver1', extensions.gen_salt('bf')), now(),
   '{"role":"driver","full_name":"Lerato Driver","business_name":"Lerato Transport","business_type":"transporter","whatsapp_phone":"+27600000005"}'::jsonb),

  -- These two stay pending on purpose, to exercise /pending and admin approval.
  ('55555555-5555-4555-8555-555555555555', 'pending-supplier@mccluckins.test', '+27600000006',
   extensions.crypt('McCluckins!Supp2', extensions.gen_salt('bf')), now(),
   '{"role":"supplier","full_name":"Pending Supplier","business_name":"Nkosi Broilers","business_type":"farm","whatsapp_phone":"+27600000006"}'::jsonb),

  ('66666666-6666-4666-8666-666666666666', 'pending-driver@mccluckins.test', '+27600000007',
   extensions.crypt('McCluckins!Driver2', extensions.gen_salt('bf')), now(),
   '{"role":"driver","full_name":"Pending Driver","business_name":"Mokoena Haulage","business_type":"transporter","whatsapp_phone":"+27600000007"}'::jsonb)
on conflict (id) do nothing;

-- Approve the four working accounts, as an admin would.
update public.profiles set status = 'active'
where id in (
  '22222222-2222-4222-8222-222222222222',
  '2b2b2b2b-2222-4222-8222-2b2b2b2b2b2b',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'
);

-- ---------------------------------------------------------------------------
-- Role detail
-- ---------------------------------------------------------------------------

insert into public.addresses (id, owner_id, label, street, town, province, location, is_default) values
  ('bbbbbbb1-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
   'Shop', '14 Vilakazi Street', 'Soweto', 'GP',
   extensions.ST_SetSRID(extensions.ST_MakePoint(27.8546, -26.2378), 4326)::extensions.geography, true),
  ('bbbbbbb1-0000-4000-8000-000000000002', '2b2b2b2b-2222-4222-8222-2b2b2b2b2b2b',
   'Kota shop', '88 Umgeni Road', 'Durban', 'KZN',
   extensions.ST_SetSRID(extensions.ST_MakePoint(31.0218, -29.8402), 4326)::extensions.geography, true)
on conflict (id) do nothing;

update public.supplier_details set
  farm_name      = 'Kopano Poultry',
  pickup_address = 'Plot 44, Rietfontein Road, Benoni',
  location       = extensions.ST_SetSRID(extensions.ST_MakePoint(28.3200, -26.1885), 4326)::extensions.geography,
  province       = 'GP',
  pdma_number    = 'PDMA-2026-0117',
  avian_flu_zone = 'none',
  paused         = false,
  paused_reason  = null
where profile_id = '33333333-3333-4333-8333-333333333333';

update public.supplier_details set
  farm_name = 'Nkosi Broilers', province = 'KZN'
where profile_id = '55555555-5555-4555-8555-555555555555';

insert into public.supplier_prices (supplier_id, bird_type, weight_band, price_cents, min_order, active) values
  ('33333333-3333-4333-8333-333333333333', 'broiler',    '2_to_2_5kg', 7500, 10, true),
  ('33333333-3333-4333-8333-333333333333', 'broiler',    '2_5_to_3kg', 8200, 10, true),
  ('33333333-3333-4333-8333-333333333333', 'hardbody',   '1_5_to_2kg', 9000, 10, true),
  ('33333333-3333-4333-8333-333333333333', 'indigenous', '1_5_to_2kg', 11000, 5, true)
on conflict (supplier_id, bird_type, weight_band) do nothing;

insert into public.supplier_requirements (
  supplier_id, crate_spec, max_per_crate, max_per_crate_hot, covered_vehicle,
  loading_window, collection_point, disinfection_photo, no_other_farm_same_day, max_journey_hours
) values (
  '33333333-3333-4333-8333-333333333333',
  'Standard 90x60x30cm ventilated poultry crate', 12, 9, true,
  '06:00–10:00', 'Loading bay 2, north gate', true, true, 2.0
) on conflict (supplier_id) do nothing;

insert into public.stock (supplier_id, week_start, bird_type, birds_available, avg_weight_kg, load_days) values
  ('33333333-3333-4333-8333-333333333333', date_trunc('week', current_date)::date,
   'broiler', 1800, 2.30, array['Mon','Wed','Fri']),
  ('33333333-3333-4333-8333-333333333333', (date_trunc('week', current_date) + interval '7 days')::date,
   'broiler', 2200, 2.35, array['Mon','Wed','Fri'])
on conflict (supplier_id, week_start, bird_type) do nothing;

update public.driver_details set
  vehicle_type = 'bakkie', gvm_kg = 3500, vehicle_reg = 'JH 12 ZN GP',
  covered = true, ventilated = true, crates_owned = 24, capacity_birds = 280,
  licence_code = 'EB', prdp = true, operator_card = true, insurance = true,
  paused = false, paused_reason = null
where profile_id = '44444444-4444-4444-8444-444444444444';

-- ---------------------------------------------------------------------------
-- One order per buyer, so the RLS suite has something real to be refused
-- ---------------------------------------------------------------------------

insert into public.quotes (
  id, buyer_id, address_id, bird_type, weight_band, quantity,
  bird_price_cents, delivery_fee_cents, service_fee_cents, total_cents, kind, status, expires_at
) values (
  'ccccccc1-0000-4000-8000-000000000001',
  '22222222-2222-4222-8222-222222222222', 'bbbbbbb1-0000-4000-8000-000000000001',
  'broiler', '2_to_2_5kg', 50,
  8625, 50400, 16858, 498508,
  'instant', 'accepted', now() + interval '30 minutes'
) on conflict (id) do nothing;

-- Supplier match and price live on the admin-only cost table, not on quotes.
insert into public.quote_costs (quote_id, matched_supplier_id, distance_km, supplier_price_cents)
values ('ccccccc1-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 38.00, 7500)
on conflict (quote_id) do nothing;

-- orders.number is assigned by the trigger, so it is deliberately not supplied here.
insert into public.orders (
  id, quote_id, buyer_id, address_id, bird_type, weight_band, quantity,
  bird_price_cents, delivery_fee_cents, service_fee_cents, total_cents,
  status, delivery_date, slot_id, delivery_code, paid_at
) values
  ('ddddddd1-0000-4000-8000-000000000001', 'ccccccc1-0000-4000-8000-000000000001',
   '22222222-2222-4222-8222-222222222222', 'bbbbbbb1-0000-4000-8000-000000000001',
   'broiler', '2_to_2_5kg', 50, 8625, 50400, 16858, 498508,
   'scheduled', current_date + 2, 'aaaaaaa1-0000-4000-8000-000000000002', '4917', now()),
  ('ddddddd1-0000-4000-8000-000000000002', null,
   '2b2b2b2b-2222-4222-8222-2b2b2b2b2b2b', 'bbbbbbb1-0000-4000-8000-000000000002',
   'hardbody', '1_5_to_2kg', 30, 10350, 34400, 11085, 327485,
   'paid', null, null, null, now())
on conflict (id) do nothing;

insert into public.order_events (order_id, status, actor_id, note) values
  ('ddddddd1-0000-4000-8000-000000000001', 'placed',    '22222222-2222-4222-8222-222222222222', 'Order placed'),
  ('ddddddd1-0000-4000-8000-000000000001', 'paid',      null, 'Paystack webhook confirmed'),
  ('ddddddd1-0000-4000-8000-000000000001', 'scheduled', '11111111-1111-4111-8111-111111111111', 'Supplier and driver assigned');

insert into public.payments (order_id, paystack_reference, channel, amount_cents, fee_cents, status) values
  ('ddddddd1-0000-4000-8000-000000000001', 'mcc_test_ref_0001', 'card', 498508, 16746, 'succeeded'),
  ('ddddddd1-0000-4000-8000-000000000002', 'mcc_test_ref_0002', 'eft',  327485,  6550, 'succeeded');

insert into public.allocations (
  id, order_id, supplier_id, quantity, supplier_price_cents,
  status, pickup_at, crosses_province
) values (
  'eeeeeee1-0000-4000-8000-000000000001', 'ddddddd1-0000-4000-8000-000000000001',
  '33333333-3333-4333-8333-333333333333', 50, 7500,
  'accepted', (current_date + 2)::timestamptz + interval '8 hours', false
) on conflict (id) do nothing;

insert into public.allocation_costs (allocation_id, distance_km)
values ('eeeeeee1-0000-4000-8000-000000000001', 38.00)
on conflict (allocation_id) do nothing;

insert into public.trips (
  id, allocation_id, driver_id, driver_share_cents, status
) values (
  'fffffff1-0000-4000-8000-000000000001', 'eeeeeee1-0000-4000-8000-000000000001',
  '44444444-4444-4444-8444-444444444444', 42840, 'assigned'
) on conflict (id) do nothing;

insert into public.trip_costs (trip_id, delivery_fee_cents)
values ('fffffff1-0000-4000-8000-000000000001', 50400)
on conflict (trip_id) do nothing;

commit;
