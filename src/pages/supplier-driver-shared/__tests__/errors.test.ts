import { describe, expect, it } from 'vitest';
import { friendlyError } from '../errors';

describe('friendlyError', () => {
  it.each([
    'job_locked', 'delivered_more_than_collected', 'invalid_delivery_code', 'too_many_reports', 'trip_not_in_transit',
    'need_count', 'need_crates', 'need_welfare', 'need_photo', 'need_permit', 'permit_expired',
    'disinfection_photo_required', 'permission denied for table allocations', 'suppliers only', 'job is already accepted',
  ])('turns %s into a sentence, never the code', (code) => {
    const text = friendlyError(code);
    expect(text).not.toBe(code);
    expect(text).toMatch(/\s/);
    expect(text).not.toMatch(/^(errors|supplier|driver)\./);
  });

  it('leaves an unknown message as it came, and handles empty input', () => {
    expect(friendlyError('Failed to fetch')).toBe('Failed to fetch');
    expect(friendlyError(null)).toBe('');
    expect(friendlyError(undefined)).toBe('');
  });
});
