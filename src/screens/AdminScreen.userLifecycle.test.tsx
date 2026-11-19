// A disabled or rejected account used to appear in the "รออนุมัติ" queue next to real new signups,
// with the same "อนุมัติ" button. Locks in the split lists, the reject button, and the
// per-user activity line.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminScreen from './AdminScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const NOW = Date.now();
describe('AdminScreen — user lifecycle lists', () => {
  it('queues only genuine signups, folds disabled/rejected away, and shows activity', async () => {
    const user = userEvent.setup();
    renderWithApp(<AdminScreen />);
    await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
    await waitFor(() => expect(hasListener('users')).toBe(true));
    fireCollection('users', [
      { id: 'admin0', role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0', dept: 'ห้องยา', active: true, createdAt: 1, lastLogin: NOW },
      { id: 'new1', role: 'tech', name: 'สมัครใหม่', username: 'newbie', dept: 'ห้องยา', active: false, createdAt: NOW, lastLogin: NOW },
      { id: 'off1', role: 'pharm', name: 'ถูกปิด', username: 'offuser', dept: 'ห้องยา', active: false, createdAt: 1, approvedAt: 2, disabledAt: NOW },
      { id: 'rej1', role: 'tech', name: 'ถูกปฏิเสธ', username: 'rejuser', dept: 'ห้องยา', active: false, createdAt: 1, rejectedAt: NOW, rejectReason: 'ไม่ใช่เจ้าหน้าที่' },
    ]);

    const queue = await screen.findByText(/รออนุมัติ \(1\)/);
    expect(queue).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'อนุมัติ สมัครใหม่' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ปฏิเสธ สมัครใหม่' })).toBeInTheDocument();
    // disabled / rejected are NOT in the approval queue
    expect(screen.queryByRole('button', { name: 'อนุมัติ ถูกปิด' })).toBeNull();
    expect(screen.queryByText('ถูกปิด')).toBeNull();

    await user.click(screen.getByRole('button', { name: /ปิดใช้งาน \/ ปฏิเสธแล้ว \(2\)/ }));
    const off = screen.getByText('ถูกปิด').closest('div')!.parentElement!;
    expect(within(off).getByText('ปิดใช้งาน')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เปิดใช้งานอีกครั้ง ถูกปิด' })).toBeInTheDocument();
    expect(screen.getByText(/เหตุผล: ไม่ใช่เจ้าหน้าที่/)).toBeInTheDocument();

    // active admin row carries the activity line
    expect(screen.getByText(/เข้าระบบ 0 ครั้ง · ทำรายการ 0 รายการ/)).toBeInTheDocument();
  });
});
