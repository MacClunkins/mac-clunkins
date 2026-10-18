// Privacy guard: data-access modules must never select buyer columns or
// supplier-price columns for the wrong role, and must read only via role views.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../i18n/en.supplier-driver.json';

const pages = join(__dirname, '..', '..');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (rel: string) => stripComments(readFileSync(join(pages, rel), 'utf8'));
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === '__tests__') return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });

const BUYER = ['buyer_id', 'buyer_name', 'buyer_phone', 'whatsapp_phone', 'address_id', 'delivery_code', 'quote_id', 'street', 'matched_supplier_id'];
const MONEY_BEYOND_SUPPLIER = ['bird_price_cents', 'delivery_fee_cents', 'service_fee_cents', 'total_cents'];
const SUPPLIER_PRICES = ['supplier_price_cents', 'supplier_prices', 'supplier_id', 'price_cents', 'min_order'];
const DRIVER_ONLY = ['driver_share_cents', 'driver_id', 'driver_details', 'pod_photo_path', 'disinfection_photo_path'];

const fromTables = (src: string) => [...src.matchAll(/\.from\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
const rpcs = (src: string) => [...src.matchAll(/\.rpc\(\s*'([a-z_]+)'/g)].map((m) => m[1]);

describe('supplier data access', () => {
  const src = read('supplier/data.ts');
  const selects = [...src.matchAll(/(?:'[^']*(?:id|at)[^']*')/g)].map((m) => m[0]).join(' ');
  it('exposes no buyer or driver-only columns anywhere in the module', () => {
    for (const col of [...BUYER, ...MONEY_BEYOND_SUPPLIER, ...DRIVER_ONLY]) expect(src, col).not.toMatch(new RegExp(`\\b${col}\\b`));
    expect(selects).not.toMatch(/buyer/);
  });
  it('reads job data only through the supplier_allocations view and never selects from allocations/orders/quotes/addresses', () => {
    const tables = fromTables(src);
    for (const bad of ['orders', 'quotes', 'addresses', 'trips', 'driver_trips', 'buyer_quotes', 'admin_allocations', 'admin_orders']) expect(tables).not.toContain(bad);
    expect(src).toMatch(/from\('supplier_allocations'\)\.select\(/);
    // the base table is write-only: every from('allocations') is followed by update(
    for (const m of src.matchAll(/from\('allocations'\)(\.\w+)/g)) expect(m[1]).toBe('.update');
  });
  it('column constants carry no forbidden names', () => {
    const cols = [...src.matchAll(/export const [A-Z_]+_COLUMNS\s*=\s*\s*'([^']+)'/g)].map((m) => m[1]).join(',');
    for (const c of [...BUYER, ...MONEY_BEYOND_SUPPLIER, ...DRIVER_ONLY]) expect(cols).not.toMatch(new RegExp(`\\b${c}\\b`));
  });
  it('supplier pages never reference buyer/driver data modules or fields', () => {
    for (const f of walk(join(pages, 'supplier'))) {
      const s = stripComments(readFileSync(f, 'utf8'));
      expect(s, f).not.toMatch(/\.\.\/driver\//);
      for (const col of [...BUYER, ...MONEY_BEYOND_SUPPLIER, 'driver_share_cents']) expect(s, `${f}:${col}`).not.toMatch(new RegExp(`\\b${col}\\b`));
    }
  });
});

describe('driver data access', () => {
  const src = read('driver/data.ts');
  it('never selects supplier price/identity columns or buyer columns', () => {
    for (const col of [...SUPPLIER_PRICES, ...BUYER, ...MONEY_BEYOND_SUPPLIER]) expect(src, col).not.toMatch(new RegExp(`\\b${col}\\b`));
  });
  it('reads trips only through driver_trips and touches no supplier/buyer tables', () => {
    const tables = fromTables(src);
    for (const bad of ['allocations', 'supplier_allocations', 'supplier_prices', 'supplier_requirements', 'supplier_details', 'orders', 'quotes', 'addresses', 'trips', 'profiles', 'stock']) expect(tables).not.toContain(bad);
    expect(tables).toContain('driver_trips');
  });
  it('gets addresses/buyer first name only through the whitelisted RPCs', () => {
    expect(rpcs(src).sort()).toEqual(['driver_confirm_delivery', 'driver_confirm_pickup', 'driver_pickup_info', 'driver_supplier_requirements', 'driver_trip_stops', 'driver_update_location']);
  });
  it('driver pages and types never name supplier price or buyer surname/phone fields', () => {
    for (const f of walk(join(pages, 'driver'))) {
      const s = stripComments(readFileSync(f, 'utf8'));
      for (const col of ['supplier_price_cents', 'supplier_prices', 'buyer_phone', 'whatsapp_phone', 'buyer_name', 'delivery_fee_cents']) expect(s, `${f}:${col}`).not.toMatch(new RegExp(`\\b${col}\\b`));
    }
  });
});

describe('i18n coverage', () => {
  const has = (key: string) => key.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined), en) !== undefined;
  it('every literal t(...) key used by these screens exists in en.supplier-driver.json', () => {
    const missing: string[] = [];
    for (const dir of ['supplier', 'driver', 'supplier-driver-shared']) {
      for (const f of walk(join(pages, dir))) {
        const s = readFileSync(f, 'utf8');
        for (const m of s.matchAll(/\bt\(\s*'([a-z0-9_.]+)'/g)) if (!has(m[1])) missing.push(`${f}: ${m[1]}`);
        for (const m of s.matchAll(/'((?:supplier|driver)\.[a-z0-9_.]*(?:need|block|fit_needs)_[a-z0-9_]+|supplier\.job\.permit_expired)'/g)) if (!has(m[1])) missing.push(`${f}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it('dynamic key families are complete', () => {
    const fam: [string, string[]][] = [
      ['supplier.status', ['offered', 'accepted', 'declined', 'ready', 'collected']],
      ['driver.status', ['assigned', 'picked_up', 'delivered', 'failed']],
      ['supplier.jobs.blocked', ['incomplete', 'in_review', 'approved', 'expired']],
      ['supplier.onb.state', ['incomplete', 'in_review', 'approved', 'expired']],
      ['transfer', ['queued', 'sent', 'success', 'failed', 'reversed']],
      ['doc.status', ['missing', 'uploaded', 'approved', 'rejected']],
      ['band', ['under_1_5kg', '1_5_to_2kg', '2_to_2_5kg', '2_5_to_3kg', 'over_3kg']],
      ['bird', ['broiler', 'hardbody', 'indigenous']],
      ['vehicle', ['bakkie', 'panel_van', 'light_truck', 'truck', 'other']],
      ['doc', ['id', 'pdma', 'cipc', 'tax_pin', 'bank_letter', 'ncd_ai_evidence', 'hpai_permit', 'supplier_agreement', 'licence', 'prdp', 'operator_card', 'roadworthy', 'insurance', 'vehicle_photo', 'contractor_agreement']],
    ];
    for (const [p, ks] of fam) for (const k of ks) expect(has(`${p}.${k}`), `${p}.${k}`).toBe(true);
    for (const k of ['empty_new', 'empty_active', 'empty_done']) expect(has(`supplier.jobs.${k}`)).toBe(true);
  });
});
