// All Supabase access for the buyer screens lives here so pages stay declarative and tests can
// mock one module. Reads use buyer-safe tables/views only. We NEVER select supplier columns
// (matched_supplier_id, supplier_price_cents, allocations, supplier_*) from anywhere.
//
// Server contracts this file ASSUMES (they are not in the migrations I was given; see PR notes):
//   rpc create_instant_quote(p_address_id, p_bird_type, p_weight_band, p_quantity)
//        -> { outcome: 'ok' | 'no_match' | 'too_far', quote_id?: uuid }
//   rpc request_custom_quote(...same args) -> uuid
//   rpc decline_quote(p_quote_id)
//   rpc buyer_order_tracking(p_order_id) -> TrackingInfo (driver FIRST name + vehicle only)
//   storage bucket `case-photos` (path `<user id>/<uuid>/<file>`)
import { supabase } from '../../lib/supabase';
import type { AppLanguage, Profile } from '../../lib/types';
import type {
  BuyerAddress,
  BuyerQuote,
  CaseEvent,
  CaseRow,
  CaseType,
  NewAddressInput,
  OrderDetail,
  OrderRow,
  OrderStatus,
  PaymentChannel,
  PaymentStatus,
  Province,
  QuoteOutcome,
  QuoteRequest,
  TrackingInfo,
} from './types';
import { getGeocoder } from './lib/geocoding';

export class ApiError extends Error {}

function fail(error: { message: string } | null): never {
  throw new ApiError(error?.message ?? 'Unknown error');
}

const ORDER_COLS =
  'id, number, bird_type, weight_band, quantity, total_cents, status, delivery_date, placed_at, address_id';

export async function listOrders(): Promise<OrderRow[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_COLS)
    .order('placed_at', { ascending: false });
  if (error) fail(error);
  return (data ?? []) as OrderRow[];
}

export async function getOrder(id: string): Promise<OrderDetail> {
  const orderQ = supabase
    .from('orders')
    .select(
      `${ORDER_COLS}, quote_id, bird_price_cents, delivery_fee_cents, service_fee_cents, delivery_code, paid_at, delivery_slots(label)`,
    )
    .eq('id', id)
    .single();
  const eventsQ = supabase
    .from('order_events')
    .select('id, status, created_at')
    .eq('order_id', id)
    .order('created_at', { ascending: true });
  const paymentQ = supabase
    .from('payments')
    .select('status, channel')
    .eq('order_id', id)
    .order('created_at', { ascending: false })
    .limit(1);
  const ratingQ = supabase.from('ratings').select('thumbs, comment').eq('order_id', id).maybeSingle();
  const caseQ = supabase.from('cases').select('id').eq('order_id', id).limit(1);

  const [o, ev, pay, rating, cs] = await Promise.all([orderQ, eventsQ, paymentQ, ratingQ, caseQ]);
  if (o.error) fail(o.error);
  const row = o.data as unknown as OrderRow & {
    quote_id: string | null;
    bird_price_cents: number;
    delivery_fee_cents: number;
    service_fee_cents: number;
    delivery_code: string | null;
    paid_at: string | null;
    delivery_slots: { label: string } | null;
  };

  let addressText: string | null = null;
  if (row.address_id) {
    const a = await supabase.from('addresses').select('street, town').eq('id', row.address_id).maybeSingle();
    if (a.data) addressText = `${a.data.street}, ${a.data.town}`;
  }
  const p = ((pay.data ?? []) as { status: PaymentStatus; channel: PaymentChannel | null }[])[0];
  const { delivery_slots, ...rest } = row;
  return {
    ...rest,
    slot_label: delivery_slots?.label ?? null,
    address_text: addressText,
    events: (ev.data ?? []) as OrderDetail['events'],
    payment_status: p?.status ?? null,
    payment_channel: p?.channel ?? null,
    rating: (rating.data as OrderDetail['rating']) ?? null,
    case_id: ((cs.data ?? []) as { id: string }[])[0]?.id ?? null,
  };
}

/** Server truth for payment pages. The UI only ever reads this. */
export async function getPayState(
  orderId: string,
): Promise<{ orderStatus: OrderStatus; paymentStatus: PaymentStatus | null }> {
  const [o, p] = await Promise.all([
    supabase.from('orders').select('status').eq('id', orderId).single(),
    supabase
      .from('payments')
      .select('status')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  if (o.error) fail(o.error);
  return {
    orderStatus: (o.data as { status: OrderStatus }).status,
    paymentStatus: ((p.data ?? []) as { status: PaymentStatus }[])[0]?.status ?? null,
  };
}

export async function getQuote(id: string): Promise<BuyerQuote> {
  const { data, error } = await supabase.from('buyer_quotes').select('*').eq('id', id).single();
  if (error) fail(error);
  return data as BuyerQuote;
}

export interface QuoteListRow {
  id: string; bird_type: string; weight_band: string; quantity: number; total_cents: number | null;
  kind: 'instant' | 'requested'; status: string; expires_at: string | null; created_at: string;
}

/** The buyer's open quotes: priced ones waiting for them, and requests still waiting for a price. */
export async function listQuotes(): Promise<QuoteListRow[]> {
  const { data, error } = await supabase
    .from('buyer_quotes')
    .select('id, bird_type, weight_band, quantity, total_cents, kind, status, expires_at, created_at')
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (error) fail(error);
  return (data ?? []) as QuoteListRow[];
}

export async function declineQuote(id: string): Promise<void> {
  const { error } = await supabase.rpc('decline_quote', { p_quote_id: id });
  if (error) fail(error);
}

export async function listProvinces(): Promise<Province[]> {
  const { data, error } = await supabase.from('provinces').select('code, name, active').eq('active', true).order('name');
  if (error) fail(error);
  return ((data ?? []) as (Province & { active: boolean })[]).map(({ code, name }) => ({ code, name }));
}

export async function listAddresses(): Promise<BuyerAddress[]> {
  const { data, error } = await supabase
    .from('addresses')
    .select('id, label, street, town, province, is_default')
    .order('is_default', { ascending: false });
  if (error) fail(error);
  return (data ?? []) as BuyerAddress[];
}

export async function saveAddress(
  ownerId: string,
  input: NewAddressInput,
  provinces: Province[],
): Promise<string> {
  const provinceName = provinces.find((p) => p.code === input.province)?.name ?? input.province;
  const point = await getGeocoder().geocode({ ...input, provinceName });
  const { data, error } = await supabase
    .from('addresses')
    .insert({
      owner_id: ownerId,
      label: input.label || null,
      street: input.street,
      town: input.town,
      province: input.province,
      location: point ? `SRID=4326;POINT(${point.lng} ${point.lat})` : null,
    })
    .select('id')
    .single();
  if (error) fail(error);
  return (data as { id: string }).id;
}

export async function deleteAddress(id: string): Promise<void> {
  const { error } = await supabase.from('addresses').delete().eq('id', id);
  if (error) fail(error);
}

export async function setDefaultAddress(ownerId: string, id: string): Promise<void> {
  const clear = await supabase.from('addresses').update({ is_default: false }).eq('owner_id', ownerId);
  if (clear.error) fail(clear.error);
  const { error } = await supabase.from('addresses').update({ is_default: true }).eq('id', id);
  if (error) fail(error);
}

function rpcArgs(r: QuoteRequest) {
  return {
    p_address_id: r.addressId,
    p_bird_type: r.birdType,
    p_weight_band: r.weightBand,
    p_quantity: r.quantity,
  };
}

export async function createInstantQuote(r: QuoteRequest): Promise<QuoteOutcome> {
  const { data, error } = await supabase.rpc('create_instant_quote', rpcArgs(r));
  if (error) fail(error);
  const res = data as { outcome: 'ok' | 'no_match' | 'too_far'; quote_id?: string } | null;
  if (!res || res.outcome !== 'ok' || !res.quote_id) {
    return { kind: 'needs_request', reason: res?.outcome === 'too_far' ? 'too_far' : 'no_match' };
  }
  return { kind: 'quote', quote: await getQuote(res.quote_id) };
}

export async function requestCustomQuote(r: QuoteRequest): Promise<string> {
  const { data, error } = await supabase.rpc('request_custom_quote', rpcArgs(r));
  if (error) fail(error);
  return data as string;
}

export async function getTracking(orderId: string): Promise<TrackingInfo | null> {
  const { data, error } = await supabase.rpc('buyer_order_tracking', { p_order_id: orderId });
  if (error) fail(error);
  return (data as TrackingInfo | null) ?? null;
}

export async function submitRating(orderId: string, thumbs: 'up' | 'down', comment: string): Promise<void> {
  const { error } = await supabase
    .from('ratings')
    .upsert({ order_id: orderId, thumbs, comment: comment.trim() || null });
  if (error) fail(error);
}

export async function uploadCasePhotos(
  userId: string,
  files: File[],
): Promise<{ paths: string[]; failed: number }> {
  const folder = `${userId}/${crypto.randomUUID()}`;
  const paths: string[] = [];
  let failed = 0;
  for (const f of files) {
    try {
      const path = `${folder}/${f.name}`;
      const { error } = await supabase.storage.from('case-photos').upload(path, f);
      if (error) failed += 1;
      else paths.push(path);
    } catch {
      failed += 1;
    }
  }
  return { paths, failed };
}

export interface NewCaseInput {
  orderId: string;
  raisedBy: string;
  type: CaseType;
  birdsAffected: number | null;
  description: string;
  photoPaths: string[];
}

export async function createCase(i: NewCaseInput): Promise<{ id: string; number: string }> {
  const { data, error } = await supabase
    .from('cases')
    .insert({
      order_id: i.orderId,
      raised_by: i.raisedBy,
      type: i.type,
      birds_affected: i.birdsAffected,
      description: i.description,
      photo_paths: i.photoPaths,
    })
    .select('id, number')
    .single();
  if (error) fail(error);
  return data as { id: string; number: string };
}

export async function getCase(id: string, myId: string): Promise<{ case: CaseRow; events: CaseEvent[] }> {
  const [c, ev] = await Promise.all([
    supabase
      .from('cases')
      .select('id, number, order_id, type, birds_affected, description, status, resolution, amount_cents, created_at')
      .eq('id', id)
      .single(),
    supabase
      .from('case_events')
      .select('id, kind, body, actor_id, created_at')
      .eq('case_id', id)
      .eq('visible_to_buyer', true)
      .order('created_at', { ascending: true }),
  ]);
  if (c.error) fail(c.error);
  const events = ((ev.data ?? []) as { id: string; kind: CaseEvent['kind']; body: string | null; actor_id: string | null; created_at: string }[]).map(
    (e) => ({ id: e.id, kind: e.kind, body: e.body, created_at: e.created_at, actor_is_me: e.actor_id === myId }),
  );
  return { case: c.data as CaseRow, events };
}

export async function replyToCase(caseId: string, myId: string, body: string): Promise<void> {
  const { error } = await supabase
    .from('case_events')
    .insert({ case_id: caseId, actor_id: myId, kind: 'message', body, visible_to_buyer: true });
  if (error) fail(error);
}

export async function listMyCases(): Promise<CaseRow[]> {
  const { data, error } = await supabase
    .from('cases')
    .select('id, number, order_id, type, birds_affected, description, status, resolution, amount_cents, created_at')
    .order('created_at', { ascending: false });
  if (error) fail(error);
  return (data ?? []) as CaseRow[];
}

export interface ProfileUpdate {
  business_name: string | null;
  whatsapp_phone: string | null;
  pdma_number: string | null;
  language: AppLanguage;
}

export async function updateProfile(id: string, u: ProfileUpdate): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').update(u).eq('id', id).select('*').single();
  if (error) fail(error);
  return data as Profile;
}
