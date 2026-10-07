// Regression tests for NumberStepper's box-primary entry mode (packSize prop) — the real-world
// request "ให้ทุกส่วนที่เติมข้อมูลเรื่องจำนวน...เติมรูปแบบ 1x60" extended box-primary entry from
// TransferScreen's own CartQtyInput to every other qty field that uses this shared stepper
// (ScanConfirmSheet/ReceiveConfirmSheet/WardMoveScreen), EXCEPT คืนยา/ปรับยอด (AdjustScreen,
// which never passes packSize — see its own "deliberately keep plain tablet-count entry"
// comment). These tests would fail against a revert of NumberStepper.tsx's packSize handling.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NumberStepper } from './NumberStepper';

describe('NumberStepper — box-primary entry (packSize prop)', () => {
  it('shows the compact "NxSIZE" box label while unfocused for a boxed med', () => {
    render(<NumberStepper value="120" onChange={() => {}} unit="เม็ด" packSize={60} />);
    expect(screen.getByRole('textbox')).toHaveValue('2x60');
  });

  it('falls back to the plain raw digit value once focused, for exact remainder typing', () => {
    render(<NumberStepper value="125" onChange={() => {}} unit="เม็ด" packSize={60} />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    expect(input).toHaveValue('125');
  });

  it('+ button steps a whole box at a time when boxed, not by 1', () => {
    const onChange = vi.fn();
    render(<NumberStepper value="60" onChange={onChange} unit="เม็ด" packSize={60} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: /เพิ่ม/ }));
    expect(onChange).toHaveBeenCalledWith('120');
  });

  it('never shows a box label when packSize is absent (adjust/return and every other plain field)', () => {
    render(<NumberStepper value="125" onChange={() => {}} unit="เม็ด" />);
    expect(screen.getByRole('textbox')).toHaveValue('125');
  });
});
