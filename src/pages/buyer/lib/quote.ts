import type { BirdType, BuyerQuote, NewAddressInput, WeightBand } from '../types';

export const MIN_QUANTITY = 10;
export const MAX_INSTANT_QUANTITY = 200;
export const MAX_INSTANT_KM = 300;
export const HOLD_MINUTES = 30;

export const BIRD_TYPES: BirdType[] = ['broiler', 'hardbody', 'indigenous'];
export const WEIGHT_BANDS: WeightBand[] = ['under_1_5kg', '1_5_to_2kg', '2_to_2_5kg', '2_5_to_3kg', 'over_3kg'];

export interface QuoteFormInput {
  birdType: BirdType | '';
  weightBand: WeightBand | '';
  quantity: string;
  /** Either a saved address id or a fully typed new address. */
  addressId: string;
  newAddress: NewAddressInput | null;
}

/** Values are i18n keys so the UI never hardcodes English. */
export type QuoteFormErrors = Partial<
  Record<'birdType' | 'weightBand' | 'quantity' | 'address', string>
>;

export function validateQuoteForm(f: QuoteFormInput): QuoteFormErrors {
  const e: QuoteFormErrors = {};
  if (!f.birdType) e.birdType = 'buyer.newOrder.errors.birdType';
  if (!f.weightBand) e.weightBand = 'buyer.newOrder.errors.weightBand';

  const q = Number(f.quantity);
  if (f.quantity.trim() === '' || !Number.isInteger(q)) e.quantity = 'buyer.newOrder.errors.quantityWhole';
  else if (q < MIN_QUANTITY) e.quantity = 'buyer.newOrder.errors.minQuantity';

  if (f.addressId) {
    // saved address chosen: fine
  } else if (
    !f.newAddress ||
    !f.newAddress.province.trim() ||
    !f.newAddress.town.trim() ||
    !f.newAddress.street.trim()
  ) {
    e.address = 'buyer.newOrder.errors.address';
  }
  return e;
}

export function exceedsInstantLimit(quantity: number): boolean {
  return quantity > MAX_INSTANT_QUANTITY;
}

export function remainingMs(expiresAt: string | null, now: number): number {
  if (!expiresAt) return 0;
  return Math.max(0, new Date(expiresAt).getTime() - now);
}

/** MM:SS under an hour, H:MM:SS from an hour up (a priced request is valid for a day, not 30 minutes). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Total for the "Birds" line. `bird_price_cents` may be stored as a line total or as a
 * per-bird price; pick whichever reconciles with `total_cents` so the screen always adds up.
 */
export function birdsLineCents(q: Pick<BuyerQuote, 'bird_price_cents' | 'delivery_fee_cents' | 'service_fee_cents' | 'total_cents' | 'quantity'>): number {
  const bird = q.bird_price_cents ?? 0;
  const rest = (q.delivery_fee_cents ?? 0) + (q.service_fee_cents ?? 0);
  if (q.total_cents === null) return bird;
  if (bird + rest === q.total_cents) return bird;
  if (bird * q.quantity + rest === q.total_cents) return bird * q.quantity;
  return q.total_cents - rest;
}
