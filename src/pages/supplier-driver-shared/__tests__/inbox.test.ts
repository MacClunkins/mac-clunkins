import { describe, expect, it } from 'vitest';
import { describeNotification } from '../inbox';

describe('describeNotification', () => {
  it('names the order and sends the buyer to it', () => {
    expect(describeNotification({ template: 'order_paid', payload: { order_id: 'o1', order_number: 'MC-0007' } }, 'buyer'))
      .toEqual({ text: 'We received your payment for order MC-0007.', to: '/orders/o1' });
    expect(describeNotification({ template: 'order_on_the_way', payload: { order_id: 'o1', order_number: 'MC-0007' } }, 'buyer').to).toBe('/orders/o1/track');
    expect(describeNotification({ template: 'order_scheduled', payload: { order_id: 'o1', order_number: 'MC-0007', delivery_date: '2026-10-20' } }, 'buyer').text)
      .toContain('2026-10-20');
  });

  it('a ready quote shows the price and opens the quote', () => {
    const d = describeNotification({ template: 'quote_ready', payload: { quote_id: 'q1', total_cents: 5703057 } }, 'buyer');
    expect(d.to).toBe('/quotes/q1');
    expect(d.text).toMatch(/R57[\s ,.]?030[.,]57/);
  });

  it('suppliers and drivers go to their own screens', () => {
    expect(describeNotification({ template: 'job_offered', payload: { quantity: 50 } }, 'supplier')).toEqual({ text: 'New job: 50 birds. Open it to accept or decline.', to: '/supplier/jobs' });
    expect(describeNotification({ template: 'trip_assigned', payload: null }, 'driver').to).toBe('/driver/trips');
    expect(describeNotification({ template: 'payout_paid', payload: { amount_cents: 450000 } }, 'supplier').to).toBe('/supplier/payouts');
    expect(describeNotification({ template: 'payout_paid', payload: { amount_cents: 28492 } }, 'driver').to).toBe('/driver/earnings');
    expect(describeNotification({ template: 'document_expiring', payload: {} }, 'driver').to).toBe('/driver/onboarding');
  });

  it('an unknown template still reads as a sentence and goes nowhere', () => {
    expect(describeNotification({ template: 'something_new', payload: null }, 'buyer')).toEqual({ text: 'You have an update.', to: null });
  });
});
