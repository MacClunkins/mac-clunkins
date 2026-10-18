// All driver data access lives here. Reads go through the role-facing
// `driver_trips` view and security-definer RPCs that return addresses and buyer
// FIRST names only. No supplier price, supplier id or buyer table is touched.
import { supabase } from '../../lib/supabase';
import type { DriverVehicle } from './types';

export const DRIVER_TRIP_COLUMNS =
  'id, allocation_id, status, driver_share_cents, pickup_count, disinfection_photo_path, forecast_temp_c, picked_up_at, delivered_count, delivered_at, pod_photo_path, created_at, updated_at';
export const DRIVER_VEHICLE_COLUMNS = 'vehicle_type, gvm_kg, vehicle_reg, covered, ventilated, crates_owned, capacity_birds';
export const DRIVER_DOCUMENT_COLUMNS = 'id, kind, file_path, status, expires_on, notes';
export const DRIVER_TRANSFER_COLUMNS = 'id, amount_cents, status, trip_id, failure_reason, created_at';

export const listTrips = () => supabase.from('driver_trips').select(DRIVER_TRIP_COLUMNS).order('created_at', { ascending: false });
export const getTrip = (id: string) => supabase.from('driver_trips').select(DRIVER_TRIP_COLUMNS).eq('id', id).single();

// BACKEND DEPENDENCY: these RPCs are specified in the PR description; none exist yet.
export const getTripStops = () => supabase.rpc('driver_trip_stops');
export const getPickupInfo = (tripId: string) => supabase.rpc('driver_pickup_info', { p_trip_id: tripId });
export const confirmPickup = (args: { p_trip_id: string; p_count: number; p_photo_path: string | null; p_short_reason?: string | null }) =>
  supabase.rpc('driver_confirm_pickup', args);
export const confirmDelivery = (args: { p_trip_id: string; p_code: string; p_count: number; p_photo_path: string | null }) =>
  supabase.rpc('driver_confirm_delivery', args);
export const listRequirementSummaries = () => supabase.rpc('driver_supplier_requirements');

// McCluckin's masked support number lives in public settings (is_public = true).
export const getSupportPhone = () => supabase.from('settings').select('key, value').eq('key', 'support_phone').maybeSingle();

export const listDriverTransfers = () =>
  supabase.from('transfers').select(DRIVER_TRANSFER_COLUMNS).order('created_at', { ascending: false });

export const getDriverVehicle = () => supabase.from('driver_details').select(DRIVER_VEHICLE_COLUMNS).maybeSingle();
export const saveDriverVehicle = (profileId: string, v: DriverVehicle) =>
  supabase.from('driver_details').upsert({ profile_id: profileId, ...v }, { onConflict: 'profile_id' });

export const listDriverDocuments = () => supabase.from('documents').select(DRIVER_DOCUMENT_COLUMNS);
export async function saveDriverDocument(profileId: string, kind: string, existingId: string | null, filePath: string, expiresOn: string | null) {
  const row = { file_path: filePath, status: 'uploaded', expires_on: expiresOn };
  return existingId
    ? supabase.from('documents').update(row).eq('id', existingId)
    : supabase.from('documents').insert({ profile_id: profileId, kind, ...row });
}

// Latest position for a trip that is on the road. The database ignores it unless the trip is picked up.
export const sendLocation = (tripId: string, lat: number, lng: number) =>
  supabase.rpc('driver_update_location', { p_trip_id: tripId, p_lat: lat, p_lng: lng });
