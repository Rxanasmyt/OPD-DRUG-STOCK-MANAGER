import { describe, it, expect } from 'vitest';
import { transferNote, parseTransferNote, parseReceiveNote } from './moveUndo';

describe('transfer note round trip', () => {
  const exp = Date.UTC(2027, 4, 31);
  it('reads back every lot take', () => {
    const n = transferNote([{ lotNo: 'A1', exp, take: 1200 }, { lotNo: undefined, exp: undefined, take: 30 }], '2 กล่อง');
    const p = parseTransferNote(n, 1230)!;
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ lotLabel: 'A1', take: 1200 });
    expect(p[1]).toMatchObject({ lotLabel: 'ไม่ระบุ lot', expText: 'ไม่ทราบวันหมดอายุ', take: 30 });
  });
  it('refuses when the lots do not add up to the qty, or the note is the old format', () => {
    expect(parseTransferNote(transferNote([{ lotNo: 'A1', exp, take: 10 }]), 11)).toBeNull();
    expect(parseTransferNote('FEFO lot A1 (10)', 10)).toBeNull();
    expect(parseTransferNote(undefined, 10)).toBeNull();
    expect(parseTransferNote('FEFO lot A1 exp 31 พ.ค. 70 (10) garbage', 10)).toBeNull();
  });
  it('keeps a lot number that contains a comma-free parenthesis', () => {
    const p = parseTransferNote(transferNote([{ lotNo: 'L(2)', exp, take: 5 }]), 5)!;
    expect(p[0].lotLabel).toBe('L(2)');
  });
});

describe('receive note', () => {
  it('reads lot and exp from commitReceive and approval notes', () => {
    expect(parseReceiveNote('ใบเบิก R1 · lot A9 exp 31 พ.ค. 70 · 2 กล่อง')).toEqual({ lotLabel: 'A9', expText: '31 พ.ค. 70' });
    expect(parseReceiveNote('ใบเบิก R1 · lot ไม่ระบุ lot exp ไม่ทราบวันหมดอายุ — อนุมัติคำขอของ X')).toEqual({ lotLabel: 'ไม่ระบุ lot', expText: 'ไม่ทราบวันหมดอายุ' });
    expect(parseReceiveNote('something else')).toBeNull();
  });
});
