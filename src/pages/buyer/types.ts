// Buyer-side types. Hand-maintained against supabase/migrations (enums + tables + views).
// Deliberately contains NO supplier fields: buyers never see supplier names, ids or prices.

export type BirdType = 'broiler' | 'hardbody' | 'indigenous';
export type WeightBand = 'under_1_5kg' | '1_5_to_2kg' | '2_to_2_5kg' | '2_5_to_3kg' | 'over_3kg';

export type OrderStatus =
  | 'placed'
  | 'paid'
  | 'scheduled'
  | 'ready'
  | 'on_the_way'
  | 'delivered'
  | 'settled'
  | 'cancelled'
  | 'refunded';

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded' | 'disputed';
export type PaymentChannel = 'card' | 'eft' | 'capitec_pay' | 'qr';

export type CaseType =
  | 'short_count'
  | 'sick_injured'
  | 'died'
  | 'late'
  | 'failed_delivery'
  | 'payment'
  | 'other';
export type CaseStatus = 'open' | 'in_review' | 'awaiting_info' | 'resolved' | 'closed';
export type CaseResolution = 'refund' | 'credit' | 'replacement' | 'none';

export type QuoteKind = 'instant' | 'requested';
export type QuoteStatus = 'open' | 'accepted' | 'expired' | 'declined';

export interface Province {
  code: string;
  name: string;
}

export interface BuyerAddress {
  id: string;
  label: string | null;
  street: string;
  town: string;
  province: string | null;
  is_default: boolean;
}

/** Row of the `orders` list screen. */
export interface OrderRow {
  id: string;
  number: string;
  bird_type: BirdType;
  weight_band: WeightBand;
  quantity: number;
  total_cents: number;
  status: OrderStatus;
  delivery_date: string | null;
  placed_at: string;
  address_id: string | null;
}

export interface OrderEvent {
  id: string;
  status: OrderStatus;
  created_at: string;
}

export interface OrderDetail extends OrderRow {
  quote_id: string | null;
  bird_price_cents: number;
  delivery_fee_cents: number;
  service_fee_cents: number;
  delivery_code: string | null;
  paid_at: string | null;
  slot_label: string | null;
  address_text: string | null;
  events: OrderEvent[];
  payment_status: PaymentStatus | null;
  payment_channel: PaymentChannel | null;
  rating: { thumbs: 'up' | 'down'; comment: string | null } | null;
  case_id: string | null;
}

/** Row of the `buyer_quotes` view (masked: no supplier columns). */
export interface BuyerQuote {
  id: string;
  address_id: string | null;
  bird_type: BirdType;
  weight_band: WeightBand;
  quantity: number;
  bird_price_cents: number | null;
  delivery_fee_cents: number | null;
  service_fee_cents: number | null;
  total_cents: number | null;
  kind: QuoteKind;
  status: QuoteStatus;
  expires_at: string | null;
  paystack_payment_link: string | null;
  created_at: string;
}

export interface QuoteRequest {
  birdType: BirdType;
  weightBand: WeightBand;
  quantity: number;
  addressId: string;
}

export type QuoteOutcome =
  | { kind: 'quote'; quote: BuyerQuote }
  | { kind: 'needs_request'; reason: 'no_match' | 'too_far' | 'too_many' };

/** Output of the (assumed) `buyer_order_tracking` RPC. Driver is FIRST NAME + vehicle only. */
export interface TrackingInfo {
  eta_at: string | null;
  driver_first_name: string | null;
  vehicle: string | null;
  call_number: string | null;
  delivered_count: number | null;
  lat: number | null;
  lng: number | null;
  /** 'live' = from the driver's position, 'window' = end of the scheduled delivery window. */
  eta_source?: 'live' | 'window' | null;
  location_updated_at?: string | null;
}

export interface CaseRow {
  id: string;
  number: string;
  order_id: string | null;
  type: CaseType;
  birds_affected: number | null;
  description: string | null;
  status: CaseStatus;
  resolution: CaseResolution | null;
  amount_cents: number | null;
  created_at: string;
}

export interface CaseEvent {
  id: string;
  kind: 'message' | 'status' | 'evidence' | 'refund';
  body: string | null;
  actor_is_me: boolean;
  created_at: string;
}

export interface NewAddressInput {
  label?: string;
  province: string;
  town: string;
  street: string;
}
