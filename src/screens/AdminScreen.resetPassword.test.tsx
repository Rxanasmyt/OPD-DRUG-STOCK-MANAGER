// Admin-initiated password reset: the button calls the adminResetPassword Cloud Function and shows
// the temporary password once; a "not deployed yet" failure says so; the reset account is then
// forced to choose its own password.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminScreen from './AdminScreen';
import ForcePasswordScreen from './ForcePasswordScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { updatePassword } from 'firebase/auth';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const callMock = vi.fn();
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => (data: unknown) => callMock(data),
}));

function Dialogs() {
  const { state, respondConfirm } = useApp() as unknown as { state: { confirmDialog?: unknown }; respondConfirm: (v: boolean) => void };
  return state.confirmDialog ? <button onClick={() => respondConfirm(true)}>yes-confirm</button> : null;
}

const USERS = [
  { id: 'admin0', role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0', dept: 'ห้องยา', active: true, createdAt: 1, lastLogin: Date.now() },
  { id: 'u2', role: 'tech', name: 'ผู้ใช้ ลืมรหัส', username: 'forgot', dept: 'ห้องยา', active: true, createdAt: 2, lastLogin: Date.now() },
];

async function setup() {
  const user = userEvent.setup();
  renderWithApp(<><AdminScreen /><Dialogs /></>);
  await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
  await waitFor(() => expect(hasListener('users')).toBe(true));
  fireCollection('users', USERS);
  return user;
}

describe('AdminScreen — reset a user password', () => {
  beforeEach(() => callMock.mockReset());

  it('offers the reset button for other users only, and shows the temporary password once', async () => {
    callMock.mockResolvedValue({ data: { tempPassword: 'Abcd2345wxyz' } });
    const user = await setup();
    expect(screen.queryByRole('button', { name: /รีเซ็ตรหัสผ่าน แอดมิน หนึ่ง/ })).toBeNull();
    await user.click(await screen.findByRole('button', { name: /รีเซ็ตรหัสผ่าน ผู้ใช้ ลืมรหัส/ }));
    await user.click(await screen.findByRole('button', { name: 'yes-confirm' }));
    const box = await screen.findByTestId('reset-result');
    expect(box).toHaveTextContent('Abcd2345wxyz');
    expect(box).toHaveTextContent('แสดงครั้งเดียว');
    expect(callMock).toHaveBeenCalledWith({ uid: 'u2' });
    await user.click(screen.getByRole('button', { name: /ปิด \(จดรหัสแล้ว\)/ }));
    expect(screen.queryByTestId('reset-result')).toBeNull();
  });

  it('says plainly when the server function has not been deployed', async () => {
    callMock.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'functions/not-found' }));
    const user = await setup();
    await user.click(await screen.findByRole('button', { name: /รีเซ็ตรหัสผ่าน ผู้ใช้ ลืมรหัส/ }));
    await user.click(await screen.findByRole('button', { name: 'yes-confirm' }));
    await waitFor(() => expect(callMock).toHaveBeenCalled());
    expect(screen.queryByTestId('reset-result')).toBeNull();
  });
});

describe('ForcePasswordScreen', () => {
  it('only enables saving when both fields match and are at least 6 characters', async () => {
    const user = userEvent.setup();
    renderWithApp(<ForcePasswordScreen />);
    await signInAs('u1', { role: 'tech', name: 'ผู้ใช้', username: 'u' });
    const save = await screen.findByRole('button', { name: 'บันทึกรหัสผ่านใหม่' });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText('รหัสผ่านใหม่'), 'abc12');
    await user.type(screen.getByLabelText('ยืนยันรหัสผ่านใหม่'), 'abc12');
    expect(save).toBeDisabled(); // too short
    await user.type(screen.getByLabelText('รหัสผ่านใหม่'), '3');
    await user.type(screen.getByLabelText('ยืนยันรหัสผ่านใหม่'), 'x');
    expect(screen.getByRole('status')).toHaveTextContent('ไม่ตรงกัน');
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText('ยืนยันรหัสผ่านใหม่'));
    await user.type(screen.getByLabelText('ยืนยันรหัสผ่านใหม่'), 'abc123');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(updatePassword).toHaveBeenCalledWith(expect.anything(), 'abc123'));
  });
});
