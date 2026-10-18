import { describe, expect, it } from 'vitest';
import type { DriverParty, QuoteCandidate } from '../api';
import { driverIssues, summariseBlockers, whatsappLink } from '../logic/blockers';

const cand = (over: Partial<QuoteCandidate>): QuoteCandidate => ({
  supplier_id: 's1', supplier_name: 'Sipho', phone: null, eligible: false, reasons: [], price_cents: 100,
  distance_km: null, same_province: true, stock_available: 10, rating_avg: null, ...over,
});
const driver = (over: Partial<DriverParty>): DriverParty => ({
  id: 'd1', name: 'Dan', phone: null, status: 'active', paused: false, capacity_birds: 100, covered: true, ...over,
});

describe('driverIssues', () => {
  it('lists everything missing', () => {
    expect(driverIssues(driver({}))).toEqual([]);
    expect(driverIssues(driver({ status: 'pending', paused: true, capacity_birds: null }))).toEqual(['not_active', 'paused', 'no_capacity']);
  });
});

describe('summariseBlockers', () => {
  it('is ready when any supplier qualifies', () => {
    const s = summariseBlockers([cand({ eligible: true }), cand({ supplier_id: 's2', reasons: ['paused'] })], []);
    expect(s.ready).toBe(true);
    expect(s.eligibleCount).toBe(1);
  });
  it('is blocked, names the suppliers, and lists only drivers that need something', () => {
    const s = summariseBlockers(
      [cand({ reasons: ['no_location', 'no_driver'] })],
      [driver({ id: 'ok' }), driver({ id: 'bad', capacity_birds: null })],
    );
    expect(s.ready).toBe(false);
    expect(s.suppliers).toHaveLength(1);
    expect(s.drivers.map((d) => [d.driver.id, d.issues])).toEqual([['bad', ['no_capacity']]]);
    expect(s.noDriversAtAll).toBe(false);
  });
  it('says so when no driver exists at all, and ignores drivers when they are not the problem', () => {
    expect(summariseBlockers([cand({ reasons: ['no_driver'] })], []).noDriversAtAll).toBe(true);
    const s = summariseBlockers([cand({ reasons: ['paused'] })], [driver({ capacity_birds: null })]);
    expect(s.drivers).toEqual([]);
    expect(s.noDriversAtAll).toBe(false);
  });
});

describe('whatsappLink', () => {
  it('turns a local number into an international one and encodes the message', () => {
    expect(whatsappLink('082 111 2222', 'Hi & bye')).toBe('https://wa.me/27821112222?text=Hi%20%26%20bye');
    expect(whatsappLink('+27 82 111 2222', 'x')).toBe('https://wa.me/27821112222?text=x');
  });
  it('gives nothing for a missing or unusable number', () => {
    expect(whatsappLink(null, 'x')).toBeNull();
    expect(whatsappLink('12', 'x')).toBeNull();
  });
});
