// Regression test for a Firestore-quota fix (see the audit log listener's own "Bug fix
// (Firestore quota incident)" doc comment in AppContext.tsx): the audit log used to sync for
// EVERY signed-in device for the whole session, regardless of what screen it was actually on —
// pure background waste on every screen besides the two that ever read state.authLog
// (ReconcileScreen, AdminScreen). Locks in that the live listener only runs while actually on one
// of those two screens, and tears back down the moment the person navigates away.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, hasListener } from '../test-utils/firebaseTestDouble';

function NavHarness() {
  const { go } = useApp();
  return (
    <>
      <button onClick={() => go('reconcile')}>go-reconcile</button>
      <button onClick={() => go('admin')}>go-admin</button>
      <button onClick={() => go('home')}>go-home</button>
    </>
  );
}

describe('AppContext — audit log listener is screen-scoped', () => {
  it('only subscribes while on reconcile/admin, and unsubscribes on navigating away', async () => {
    const user = userEvent.setup();
    renderWithApp(<NavHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    // Lands on 'home' right after sign-in (see the myProfile listener's own comment) — not
    // one of the two screens that need it.
    expect(hasListener('auditLog')).toBe(false);

    await user.click(screen.getByText('go-reconcile'));
    await waitFor(() => expect(hasListener('auditLog')).toBe(true));

    await user.click(screen.getByText('go-home'));
    await waitFor(() => expect(hasListener('auditLog')).toBe(false));

    await user.click(screen.getByText('go-admin'));
    await waitFor(() => expect(hasListener('auditLog')).toBe(true));

    await user.click(screen.getByText('go-home'));
    await waitFor(() => expect(hasListener('auditLog')).toBe(false));
  });
});
