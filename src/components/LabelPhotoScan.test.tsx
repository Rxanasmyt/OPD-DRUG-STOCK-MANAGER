import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LabelPhotoScan } from './LabelPhotoScan';

vi.mock('../utils/ocrEngine', async () => {
  const { parseLabelText } = await import('../utils/labelOcr');
  return {
    scanLabelPhoto: async () => ({ ...parseLabelText('EXP 01/2028\nLOT AM250201', Date.parse('2026-11-20T00:00:00Z')), text: '' }),
  };
});

describe('LabelPhotoScan', () => {
  it('pre-fills empty Lot/expiry from the photo and lets the user pick candidates', async () => {
    (globalThis.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
    (globalThis.URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    const onLot = vi.fn(); const onExp = vi.fn();
    render(<LabelPhotoScan onLot={onLot} onExp={onExp} currentLot="" currentExp="" />);
    fireEvent.change(screen.getByTestId('label-photo-input'), { target: { files: [new File(['x'], 'box.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(onExp).toHaveBeenCalledWith('2028-01-31'));
    expect(onLot).toHaveBeenCalledWith('AM250201');
    expect(await screen.findByTestId('label-scan-result')).toBeInTheDocument();
  });
  it('never overwrites a value the user already typed', async () => {
    (globalThis.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
    const onLot = vi.fn(); const onExp = vi.fn();
    render(<LabelPhotoScan onLot={onLot} onExp={onExp} currentLot="MINE1" currentExp="2030-01-01" />);
    fireEvent.change(screen.getByTestId('label-photo-input'), { target: { files: [new File(['x'], 'box.jpg', { type: 'image/jpeg' })] } });
    await screen.findByTestId('label-scan-result');
    expect(onLot).not.toHaveBeenCalled();
    expect(onExp).not.toHaveBeenCalled();
  });
});
