// All supplier data access lives here. Reads go through the role-facing
// `supplier_allocations` view (no buyer columns). Suppliers have no write grant on the base
// `allocations` table, so every change to a job goes through a supplier_* function.
import { supabase } from '../../lib/supabase';
import type { BankMasked, PriceRow, Requirements, StockRow } from './types';

export const SUPPLIER_ALLOCATION_COLUMNS =
  'id, order_id, quantity, supplier_price_cents, status, pickup_at, birds_counted, crates, welfare_ok, load_photo_path, removal_permit_path, permit_valid_until, crosses_province, movement_permit_path, created_at, updated_at';
export const STOCK_COLUMNS = 'id, week_start, bird_type, birds_available, avg_weight_kg, load_days';
export const PRICE_COLUMNS = 'bird_type, weight_band, price_cents, min_order, active';
export const REQUIREMENT_COLUMNS =
  'crate_spec, max_per_crate, max_per_crate_hot, covered_vehicle, loading_window, collection_point, disinfection_photo, no_other_farm_same_day, max_journey_hours';
export const SUPPLIER_DETAIL_COLUMNS = 'farm_name, pickup_address, province, paused, paused_reason';
export const DOCUMENT_COLUMNS = 'id, kind, file_path, status, expires_on, notes';
export const TRANSFER_COLUMNS = 'id, amount_cents, status, allocation_id, failure_reason, created_at';

export const listAllocations = () =>
  supabase.from('supplier_allocations').select(SUPPLIER_ALLOCATION_COLUMNS).order('created_at', { ascending: false });

export const getAllocation = (id: string) =>
  supabase.from('supplier_allocations').select(SUPPLIER_ALLOCATION_COLUMNS).eq('id', id).single();

export const respondToAllocation = (id: string, accept: boolean) =>
  supabase.rpc('supplier_respond_allocation', { p_allocation_id: id, p_accept: accept });

export const saveAllocationProgress = (
  id: string,
  patch: Partial<{
    birds_counted: number;
    crates: number;
    welfare_ok: boolean;
    load_photo_path: string;
    removal_permit_path: string;
    permit_valid_until: string;
  }>,
) => supabase.rpc('supplier_update_allocation', { p_allocation_id: id, p_patch: patch });

export const markAllocationReady = (id: string) => supabase.rpc('supplier_mark_ready', { p_allocation_id: id });

export const listStock = (weekStarts: string[]) =>
  supabase.from('stock').select(STOCK_COLUMNS).in('week_start', weekStarts);

export const upsertStock = (supplierId: string, rows: StockRow[]) =>
  supabase.from('stock').upsert(
    rows.map((r) => ({
      supplier_id: supplierId,
      week_start: r.week_start,
      bird_type: r.bird_type,
      birds_available: r.birds_available,
      avg_weight_kg: r.avg_weight_kg,
      load_days: r.load_days,
    })),
    { onConflict: 'supplier_id,week_start,bird_type' },
  );

export const listPrices = () => supabase.from('supplier_prices').select(PRICE_COLUMNS);

export const upsertPrices = (supplierId: string, rows: PriceRow[]) =>
  supabase.from('supplier_prices').upsert(
    rows.map((r) => ({ supplier_id: supplierId, ...r })),
    { onConflict: 'supplier_id,bird_type,weight_band' },
  );

export const getRequirements = () => supabase.from('supplier_requirements').select(REQUIREMENT_COLUMNS).maybeSingle();

export const saveRequirements = (supplierId: string, r: Requirements) =>
  supabase.from('supplier_requirements').upsert({ supplier_id: supplierId, ...r }, { onConflict: 'supplier_id' });

export const getSupplierDetails = () => supabase.from('supplier_details').select(SUPPLIER_DETAIL_COLUMNS).maybeSingle();

export const saveSupplierDetails = (
  profileId: string,
  d: { farm_name: string; pickup_address: string; province: string; location?: string },
) => supabase.from('supplier_details').upsert({ profile_id: profileId, ...d }, { onConflict: 'profile_id' });

/** Saves the farm gate position on its own, so it is stored the moment the supplier captures it. */
export const saveSupplierLocation = (profileId: string, location: string) =>
  supabase.from('supplier_details').update({ location }).eq('profile_id', profileId);

export const listProvinces = () => supabase.from('provinces').select('code, name').eq('active', true).order('name');

export const listDocuments = () => supabase.from('documents').select(DOCUMENT_COLUMNS);

/** Adds or replaces a document. The database sets the status to uploaded, so an admin reviews it again. */
export async function saveDocument(
  _profileId: string,
  kind: string,
  _existingId: string | null,
  filePath: string,
  expiresOn: string | null,
) {
  return supabase.rpc('submit_document', { p_kind: kind, p_file_path: filePath, p_expires_on: expiresOn });
}

// RLS limits transfers to the caller's own rows.
export const listTransfers = () =>
  supabase.from('transfers').select(TRANSFER_COLUMNS).order('created_at', { ascending: false });

// BACKEND DEPENDENCY: bank details are encrypted at rest (bytea) so the browser
// can neither write nor read them directly. These RPCs do not exist yet.
export const saveBankDetails = (input: { bank_name: string; account_holder: string; account_number: string; branch_code: string }) =>
  supabase.rpc('save_bank_details', input);

export const getBankMasked = () => supabase.rpc('get_bank_details_masked').maybeSingle<BankMasked>();
