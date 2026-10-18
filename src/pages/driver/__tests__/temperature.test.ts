import { describe, expect, it } from 'vitest';
import { birdsPerCrateLimit, currentTempFrom, forecastUrl, isHeatWarning, parseTemperature } from '../rules';

describe('heat threshold', () => {
  it('uses the admin setting when given, and 30 when not', () => {
    expect(isHeatWarning(31)).toBe(true);
    expect(isHeatWarning(30)).toBe(false);
    expect(isHeatWarning(28, 25)).toBe(true);
    expect(isHeatWarning(28, 35)).toBe(false);
    expect(isHeatWarning(null, 25)).toBe(false);
  });
  it('the hot-day crate limit follows the threshold', () => {
    const rule = { max_per_crate: 10, max_per_crate_hot: 8 };
    expect(birdsPerCrateLimit(rule, 28)).toEqual({ limit: 10, hot: false });
    expect(birdsPerCrateLimit(rule, 28, 25)).toEqual({ limit: 8, hot: true });
  });
});

describe('thermometer reading', () => {
  it('accepts plain numbers with an optional decimal', () => {
    expect(parseTemperature('31')).toBe(31);
    expect(parseTemperature(' 31.5 ')).toBe(31.5);
    expect(parseTemperature('31,5')).toBe(31.5);
    expect(parseTemperature('-3')).toBe(-3);
    expect(parseTemperature('0')).toBe(0);
  });
  it('rejects everything else', () => {
    for (const bad of ['', 'hot', '60', '-11', '31.55', '3e1', '31°', '1000']) expect(parseTemperature(bad), bad).toBeNull();
  });
});

describe('forecast', () => {
  it('builds the request without a key, rounded coordinates', () => {
    expect(forecastUrl(-26.2378, 27.8546)).toBe('https://api.open-meteo.com/v1/forecast?latitude=-26.2378&longitude=27.8546&current=temperature_2m&timezone=auto');
  });
  it('reads the current temperature and ignores anything unexpected', () => {
    expect(currentTempFrom({ current: { temperature_2m: 23.46 } })).toBe(23.5);
    expect(currentTempFrom({ current: { temperature_2m: 'warm' } })).toBeNull();
    expect(currentTempFrom({ current: { temperature_2m: 90 } })).toBeNull();
    expect(currentTempFrom({})).toBeNull();
    expect(currentTempFrom(null)).toBeNull();
  });
});
