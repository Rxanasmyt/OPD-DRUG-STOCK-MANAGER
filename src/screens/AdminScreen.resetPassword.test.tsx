// Forgot-password help: Firebase only lets a server change someone else's password and this project
// has no Cloud Functions, so the admin button opens step-by-step instructions for the manually-run
// GitHub Action (with the username to paste). The reset account is then forced to choose its own
// password on next login.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminScreen from './AdminScreen';
import ForcePasswordScreen from './ForcePasswordScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { updatePassword } from 'firebase/auth';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const USERS = [
  { id: 'admin0', role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0', dept: 'ห้องยา', active: true, createdAt: 1, lastLogin: Date.now() },
  { id: 'u2', role: 'tech', name: 'ผู้ใช้ ลืมรหัส', username: 'forgot', dept: 'ห้องยา', active: true, createdAt: 2, lastLogin: Date.now() },
];

describe('AdminScreen — forgot-password help', () => {
  it('offers it for other users only, and shows the username + link to the reset workflow', async () => {
    const user = userEvent.setup();
    renderWithApp(<AdminScreen />);
    await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
    await waitFor(() => expect(hasListener('users')).toBe(true));
    fireCollection('users', USERS);

    expect(screen.queryByRole('button', { name: /รีเซ็ตรหัสผ่าน แอดมิน หนึ่ง/ })).toBeNull();
    await user.click(await screen.findByRole('button', { name: /รีเซ็ตรหัสผ่าน ผู้ใช้ ลืมรหัส/ }));
    const box = await screen.findByTestId('reset-help');
    expect(box).toHaveTextContent('forgot');
    expect(box).toHaveTextContent('Run workflow');
    const link = screen.getByRole('link', { name: /เปิดหน้ารีเซ็ต/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('/actions/workflows/reset-user-password.yml'));
    await user.click(screen.getByRole('button', { name: 'ปิด' }));
    expect(screen.queryByTestId('reset-help')).toBeNull();
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
