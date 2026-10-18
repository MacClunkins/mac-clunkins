import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

import { updateArea, updateSettings, type DbClient } from '../api';
import { SETTING_DEFS, defFor, validateSetting } from '../logic/settings';

function fakeClient(error: { message: string } | null = null) {
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const client = {
    from() { throw new Error('settings must be written through the RPC, not table writes'); },
    rpc: async (fn: string, args: unknown) => { rpcCalls.push({ fn, args }); return { data: null, error }; },
  } as unknown as DbClient;
  return { client, rpcCalls };
}

describe('settings validation', () => {
  it('covers every settings key from the spec', () => {
    expect(SETTING_DEFS.map((d) => d.key).sort()).toEqual([
      'delivery_base_cents', 'delivery_per_bird_cents', 'delivery_per_km_cents', 'delivery_timeline', 'driver_share_pct',
      'heat_warn_c', 'issue_window_hours', 'journey_warn_hours', 'markup_pct', 'min_margin_cents', 'min_order',
      'quote_hold_minutes', 'rfq_max_km', 'rfq_min_birds', 'service_fee_pct', 'unpaid_cancel_hours',
    ]);
  });
  it('percent must be 0-100', () => {
    const d = defFor('markup_pct')!;
    expect(validateSetting(d, '15')).toEqual({ ok: true, value: 15 });
    expect(validateSetting(d, '3.5')).toEqual({ ok: true, value: 3.5 });
    expect(validateSetting(d, '0')).toEqual({ ok: true, value: 0 });
    expect(validateSetting(d, '100')).toEqual({ ok: true, value: 100 });
    expect(validateSetting(d, '101')).toEqual({ ok: false, error: 'percent_range' });
    expect(validateSetting(d, '-1')).toEqual({ ok: false, error: 'percent_range' });
    expect(validateSetting(d, 'abc')).toEqual({ ok: false, error: 'not_a_number' });
    expect(validateSetting(d, '')).toEqual({ ok: false, error: 'required' });
  });
  it('cents must be whole non-negative numbers', () => {
    const d = defFor('min_margin_cents')!;
    expect(validateSetting(d, '800')).toEqual({ ok: true, value: 800 });
    expect(validateSetting(d, '8.5')).toEqual({ ok: false, error: 'not_integer' });
    expect(validateSetting(d, '-800')).toEqual({ ok: false, error: 'negative' });
  });
  it('delivery timeline may stay unset', () => {
    expect(validateSetting(defFor('delivery_timeline')!, '  ')).toEqual({ ok: true, value: null });
  });
});

describe('updateSettings (data layer)', () => {
  it('sends only the changed keys to admin_update_settings and never touches tables', async () => {
    const { client, rpcCalls } = fakeClient();
    const r = await updateSettings('admin-1', { markup_pct: 15, min_margin_cents: 800 }, { markup_pct: 18, min_margin_cents: 800 }, client);
    expect(r.error).toBeNull();
    expect(r.changed).toEqual(['markup_pct']);
    expect(rpcCalls).toEqual([{ fn: 'admin_update_settings', args: { p_changes: { markup_pct: 18 } } }]);
  });
  it('rejects invalid values with no call at all', async () => {
    const { client, rpcCalls } = fakeClient();
    const pct = await updateSettings('a', { markup_pct: 15 }, { markup_pct: 150 }, client);
    expect(pct.error?.code).toBe('percent_range');
    const cents = await updateSettings('a', { min_margin_cents: 800 }, { min_margin_cents: 8.5 }, client);
    expect(cents.error?.code).toBe('not_integer');
    expect(rpcCalls).toEqual([]);
  });
  it('returns the database error and reports nothing as changed', async () => {
    const { client } = fakeClient({ message: 'only an admin can change settings' });
    const r = await updateSettings('a', { markup_pct: 15 }, { markup_pct: 16 }, client);
    expect(r.error?.message).toBe('only an admin can change settings');
    expect(r.changed).toEqual([]);
  });
});

describe('updateArea (data layer)', () => {
  it('calls admin_update_area', async () => {
    const { client, rpcCalls } = fakeClient();
    const r = await updateArea('a', { province: 'GP', active: false, launch_order: null }, { active: true, launch_order: 2 }, client);
    expect(r.error).toBeNull();
    expect(rpcCalls).toEqual([{ fn: 'admin_update_area', args: { p_province: 'GP', p_active: true, p_launch_order: 2 } }]);
  });
});
