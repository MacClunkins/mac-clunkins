import { describe, expect, it } from 'vitest';
import { formatWindow, parseWindow, windowError } from '../logic';

describe('loading window', () => {
  it('reads the formats people have typed so far', () => {
    expect(parseWindow('05:00-07:00')).toEqual({ from: '05:00', to: '07:00' });
    expect(parseWindow('05:00 - 08:00')).toEqual({ from: '05:00', to: '08:00' });
    expect(parseWindow('5:00 to 7:30')).toEqual({ from: '05:00', to: '07:30' });
  });
  it('gives an empty window for anything it cannot read', () => {
    expect(parseWindow(null)).toEqual({ from: '', to: '' });
    expect(parseWindow('')).toEqual({ from: '', to: '' });
    expect(parseWindow('early morning')).toEqual({ from: '', to: '' });
    expect(parseWindow('25:00-26:00')).toEqual({ from: '', to: '' });
  });
  it('stores HH:MM-HH:MM, or nothing when both are cleared', () => {
    expect(formatWindow({ from: '05:00', to: '07:00' })).toBe('05:00-07:00');
    expect(formatWindow({ from: '', to: '' })).toBeNull();
  });
  it('flags half a window and a window that ends before it starts', () => {
    expect(windowError({ from: '', to: '' })).toBeNull();
    expect(windowError({ from: '05:00', to: '' })).toBe('incomplete');
    expect(windowError({ from: '08:00', to: '05:00' })).toBe('order');
    expect(windowError({ from: '05:00', to: '05:00' })).toBe('order');
    expect(windowError({ from: '05:00', to: '07:00' })).toBeNull();
  });
});
