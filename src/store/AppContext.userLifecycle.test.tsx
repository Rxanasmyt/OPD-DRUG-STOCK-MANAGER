// Account-lifecycle regression: a disabled account used to be indistinguishable from a pending
// signup (both just `active:false`), and `lastLogin` — which a pending account's own login attempt
// also sets — was used to guess "first approval vs reinstatement". Approve/disable/reject now
// stamp explicit fields; this locks in what each action writes.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener, seedCollection, seedDoc, getLastTransactionWrites } from '../test-utils/firebaseTestDouble';

function Actions() {
  const { toggleUserActive, rejectUser, respondPrompt, state } = useApp();
  return (
    <>
      <button onClick={() => toggleUserActive('u1')}>toggle-u1</button>
      <button onClick={() => void rejectUser('u1')}>reject-u1</button>
      <button onClick={() => respondPrompt('ไม่ใช่เจ้าหน้าที่ห้องยา')}>answer-prompt</button>
      <button onClick={() => respondPrompt(null)}>cancel-prompt</button>
      <span data-testid="prompt">{state.promptDialog ? 'open' : 'none'}</span>
    </>
  );
}

async function setup(target: Record<string, unknown>) {
  const user = userEvent.setup();
  renderWithApp(<Actions />);
  await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
  await waitFor(() => expect(hasListener('users')).toBe(true));
  const base: Record<string, unknown> = { id: 'u1', role: 'tech', name: 'ผู้สมัคร', username: 'applicant', dept: 'ห้องยา', createdAt: 1, ...target };
  fireCollection('users', [{ id: 'admin0', role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0', active: true }, base]);
  seedCollection('users', [{ id: 'admin0' }]);
  seedDoc('users/admin0', { role: 'admin', active: true });
  seedDoc('users/u1', { role: 'tech', active: base.active });
  return user;
}

describe('user lifecycle stamps', () => {
  it('approving a pending signup stamps approvedAt and clears any rejection', async () => {
    const user = await setup({ active: false, lastLogin: 5 /* pending account that merely tried to log in */ });
    await user.click(screen.getByRole('button', { name: 'toggle-u1' }));
    await waitFor(() => expect(getLastTransactionWrites().some((w) => w.path === 'users/u1')).toBe(true));
    const w = getLastTransactionWrites().find((x) => x.path === 'users/u1')!;
    expect(w.data).toMatchObject({ active: true, rejectedAt: null, rejectReason: null });
    expect(typeof w.data.approvedAt).toBe('number');
  });

  it('disabling an active account stamps disabledAt', async () => {
    const user = await setup({ active: true, approvedAt: 10, lastLogin: 20 });
    await user.click(screen.getByRole('button', { name: 'toggle-u1' }));
    await waitFor(() => expect(getLastTransactionWrites().some((w) => w.path === 'users/u1')).toBe(true));
    const w = getLastTransactionWrites().find((x) => x.path === 'users/u1')!;
    expect(w.data.active).toBe(false);
    expect(typeof w.data.disabledAt).toBe('number');
  });

  it('rejecting asks for a reason and stamps rejectedAt + rejectReason (account stays inactive)', async () => {
    const user = await setup({ active: false });
    await user.click(screen.getByRole('button', { name: 'reject-u1' }));
    await waitFor(() => expect(screen.getByTestId('prompt').textContent).toBe('open'));
    await user.click(screen.getByRole('button', { name: 'answer-prompt' }));
    await waitFor(() => expect(getLastTransactionWrites().some((w) => w.path === 'users/u1')).toBe(true));
    const w = getLastTransactionWrites().find((x) => x.path === 'users/u1')!;
    expect(w.data).toMatchObject({ active: false, rejectReason: 'ไม่ใช่เจ้าหน้าที่ห้องยา' });
    expect(typeof w.data.rejectedAt).toBe('number');
  });

  it('cancelling the reason prompt rejects nobody', async () => {
    const user = await setup({ active: false });
    await user.click(screen.getByRole('button', { name: 'reject-u1' }));
    await waitFor(() => expect(screen.getByTestId('prompt').textContent).toBe('open'));
    await user.click(screen.getByRole('button', { name: 'cancel-prompt' }));
    await waitFor(() => expect(screen.getByTestId('prompt').textContent).toBe('none'));
    expect(getLastTransactionWrites().some((w) => w.path === 'users/u1')).toBe(false);
  });
});
