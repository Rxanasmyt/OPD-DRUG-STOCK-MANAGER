import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LabelLiveScan } from './LabelLiveScan';
import { liveScanVerdict, mergeParses, parseLabelText } from '../utils/labelOcr';

const frames: string[] = [];
vi.mock('../utils/ocrEngine', async () => {
  const { parseLabelText: parse } = await import('../utils/labelOcr');
  return {
    grabFrame: async () => new Blob(['f']),
    scanLiveFrame: async () => parse(frames.shift() ?? ''),
  };
});

function fakeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }], getVideoTracks: () => [{ applyConstraints: async () => undefined, stop }] } as unknown as MediaStream, stop };
}
afterEach(() => { frames.length = 0; });

describe('liveScanVerdict', () => {
  it('needs the value in 2+ frames: one frame is never enough', () => {
    const one = mergeParses([parseLabelText('EXP 01/2028 LOT AM250201')]);
    expect(liveScanVerdict(one, 1)).toBe('continue');
    const two = mergeParses([parseLabelText('EXP 01/2028 LOT AM250201'), parseLabelText('EXP 01/2028 LOT AM250201')]);
    expect(liveScanVerdict(two, 2)).toBe('done');
  });
  it('accepts a confident expiry without a Lot after the grace frames (some boxes print none)', () => {
    const p = mergeParses([parseLabelText('EXP 01/2028'), parseLabelText('EXP 01/2028')]);
    expect(liveScanVerdict(p, 3)).toBe('continue');
    expect(liveScanVerdict(p, 8)).toBe('done');
  });
});

describe('LabelLiveScan', () => {
  it('reads frames with no shutter tap, pre-fills Lot/expiry once two frames agree, and releases the camera', async () => {
    const { stream, stop } = fakeStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => stream) } });
    frames.push('EXP 01/2028\nLOT AM250201', 'EXP 01/2028\nLOT AM250201');
    const onLot = vi.fn(), onExp = vi.fn();
    const { unmount } = render(<LabelLiveScan onLot={onLot} onExp={onExp} currentLot="" currentExp="" onClose={() => {}} />);
    await waitFor(() => expect(onExp).toHaveBeenCalledWith('2028-01-31'), { timeout: 4000 });
    expect(onLot).toHaveBeenCalledWith('AM250201');
    expect(screen.getByTestId('live-stage').textContent).toContain('อ่านได้แล้ว');
    unmount();
    expect(stop).toHaveBeenCalled();
  });
  it('never overwrites a value the user already typed', async () => {
    const { stream } = fakeStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => stream) } });
    frames.push('EXP 01/2028\nLOT AM250201', 'EXP 01/2028\nLOT AM250201');
    const onLot = vi.fn(), onExp = vi.fn();
    render(<LabelLiveScan onLot={onLot} onExp={onExp} currentLot="MINE1" currentExp="2030-01-01" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('live-stage').textContent).toContain('อ่านได้แล้ว'), { timeout: 4000 });
    expect(onLot).not.toHaveBeenCalled();
    expect(onExp).not.toHaveBeenCalled();
  });
  it('shows a clear fallback message when camera permission is denied', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => { throw new Error('denied'); }) } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<LabelLiveScan onLot={() => {}} onExp={() => {}} currentLot="" currentExp="" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('live-stage').textContent).toContain('เปิดกล้องไม่ได้'));
    spy.mockRestore();
  });
  it('the close button calls onClose', async () => {
    const { stream } = fakeStream();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => stream) } });
    const onClose = vi.fn();
    render(<LabelLiveScan onLot={() => {}} onExp={() => {}} currentLot="" currentExp="" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /ปิดกล้อง/ }));
    expect(onClose).toHaveBeenCalled();
  });
});
