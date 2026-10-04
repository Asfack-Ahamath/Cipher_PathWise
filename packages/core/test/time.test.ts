import { describe, expect, it } from 'vitest';
import { parseWindow, toHHMM, toMin } from '../src/index';

describe('time helpers', () => {
  it('toMin converts HH:MM to minutes since midnight', () => {
    expect(toMin('00:00')).toBe(0);
    expect(toMin('05:35')).toBe(335);
    expect(toMin('16:00')).toBe(960);
    expect(toMin('29:59')).toBe(29 * 60 + 59); // late-night windows are allowed by the database
  });
  it('toMin treats a missing minutes part as zero', () => { expect(toMin('7')).toBe(420); });
  it('toHHMM formats minutes, rounding and wrapping past midnight', () => {
    expect(toHHMM(0)).toBe('00:00');
    expect(toHHMM(335)).toBe('05:35');
    expect(toHHMM(335.4)).toBe('05:35');
    expect(toHHMM(335.6)).toBe('05:36');
    expect(toHHMM(24 * 60 + 5)).toBe('00:05');
  });
  it('toHHMM and toMin round-trip within a day', () => {
    for (const m of [0, 1, 59, 60, 335, 720, 1439]) expect(toMin(toHHMM(m))).toBe(m);
  });
  it('parseWindow reads en-dash and hyphen separated windows', () => {
    expect(parseWindow('10:30–12:30')).toEqual([630, 750]);
    expect(parseWindow('10:30-12:30')).toEqual([630, 750]);
    expect(parseWindow(' 08:00 – 09:15 ')).toEqual([480, 555]);
  });
  it('parseWindow returns null when there is no usable window', () => {
    expect(parseWindow()).toBeNull();
    expect(parseWindow(null)).toBeNull();
    expect(parseWindow('')).toBeNull();
    expect(parseWindow('10:30')).toBeNull();
  });
});
