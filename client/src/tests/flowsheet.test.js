import { describe, it, expect } from 'vitest';
import { getScannedNumber } from '../utils/flowsheet.js';

describe('getScannedNumber', () => {
  it('returns parsedValue when it is a finite number', () => {
    expect(getScannedNumber(12.5, '12.5')).toBe(12.5);
    expect(getScannedNumber(0, '0')).toBe(0);
    expect(getScannedNumber('120', '120')).toBe(120);
  });

  it('extracts number from rawValue when parsedValue is null or undefined', () => {
    expect(getScannedNumber(null, '14.2')).toBe(14.2);
    expect(getScannedNumber(undefined, '98.6')).toBe(98.6);
    expect(getScannedNumber(null, '12.5 g/dL')).toBe(12.5);
  });

  it('returns null for qualitative, bound, or unreadable values', () => {
    expect(getScannedNumber(null, '<0.5')).toBeNull();
    expect(getScannedNumber(null, '>100')).toBeNull();
    expect(getScannedNumber(null, 'Negative')).toBeNull();
    expect(getScannedNumber(null, 'Trace')).toBeNull();
    expect(getScannedNumber(null, '')).toBeNull();
    expect(getScannedNumber(null, null)).toBeNull();
  });
});
