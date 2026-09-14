import { describe, it, expect } from 'vitest';
import { encodeQr, parseQr } from './qr';

describe('encodeQr / parseQr round-trip', () => {
  it('round-trips every payload type through JSON encoding', () => {
    for (const t of ['med', 'lot', 'loc'] as const) {
      const encoded = encodeQr(t, 'ABC-123');
      expect(parseQr(encoded)).toEqual({ t, id: 'ABC-123' });
    }
  });
});

describe('parseQr manual-entry fallback (damaged-label bare-code typing)', () => {
  it('infers type from a bare code prefix, forcing uppercase', () => {
    expect(parseQr('lot-0035-1')).toEqual({ t: 'lot', id: 'LOT-0035-1' });
    expect(parseQr('med-0035')).toEqual({ t: 'med', id: 'MED-0035' });
    expect(parseQr('loc-a1')).toEqual({ t: 'loc', id: 'LOC-A1' });
  });

  it('rejects unrecognized input rather than guessing', () => {
    expect(parseQr('')).toBeNull();
    expect(parseQr('   ')).toBeNull();
    expect(parseQr('not-a-real-code')).toBeNull();
    expect(parseQr('{"t":"bogus","id":"x"}')).toBeNull();
  });

  it('rejects a JSON payload missing a required field', () => {
    expect(parseQr('{"t":"med"}')).toBeNull();
    expect(parseQr('{"id":"MED-1"}')).toBeNull();
  });
});
