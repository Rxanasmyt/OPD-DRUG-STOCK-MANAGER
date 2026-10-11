// Regression test for a real audit finding: ConfirmDialog/PromptDialog had no focus trap and
// never restored focus to the triggering element on close, unlike BottomSheet.tsx which fixed
// this exact bug class already (see its own "Bug fix (accessibility — focus trap)" comment).
// These two guard the app's most consequential actions (ยืนยันลบถาวร, ปิดใช้งานบัญชี, ...), so a
// keyboard/switch-device user Tab-ing straight out into the (supposedly inert) screen behind it
// mattered more here than on a cosmetic surface.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from '../store/AppContext';
import ConfirmDialog from './ConfirmDialog';
import { renderWithApp } from '../test-utils/renderWithApp';

// confirmAsync itself is internal to AppContext.tsx (never exposed via useApp()) — every real
// screen reaches ConfirmDialog through one of AppContext's own actions that calls it
// internally. confirmLeaveIfDirty() is the simplest one reachable with no Firestore/meds setup:
// it only needs a dirty form flag, then calls confirmAsync with a real, representative message.
function TriggerHarness() {
  const { setFormDirty, confirmLeaveIfDirty } = useApp();
  return (
    <>
      <button onClick={() => { setFormDirty(true); void confirmLeaveIfDirty(); }}>open-confirm</button>
      <ConfirmDialog />
    </>
  );
}

describe('ConfirmDialog — focus trap & restore regression', () => {
  it('moves focus onto ยกเลิก (the safe default) when opened', async () => {
    const user = userEvent.setup();
    renderWithApp(<TriggerHarness />);
    await user.click(screen.getByRole('button', { name: 'open-confirm' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'ยกเลิก' })).toHaveFocus());
  });

  it('wraps Tab from the last button back to the first, and Shift+Tab from the first to the last', async () => {
    const user = userEvent.setup();
    renderWithApp(<TriggerHarness />);
    await user.click(screen.getByRole('button', { name: 'open-confirm' }));
    const cancelBtn = screen.getByRole('button', { name: 'ยกเลิก' });
    const confirmBtn = screen.getByRole('button', { name: 'ยืนยัน' });
    await waitFor(() => expect(cancelBtn).toHaveFocus());

    // Without the fix, Tab from the last focusable element would walk out of the dialog
    // entirely (e.g. onto the real screen's own controls behind it) instead of wrapping.
    await user.tab();
    expect(confirmBtn).toHaveFocus();
    await user.tab();
    expect(cancelBtn).toHaveFocus();

    await user.tab({ shift: true });
    expect(confirmBtn).toHaveFocus();
  });

  it('restores focus to the button that opened the dialog, after it closes', async () => {
    const user = userEvent.setup();
    renderWithApp(<TriggerHarness />);
    const openBtn = screen.getByRole('button', { name: 'open-confirm' });
    await user.click(openBtn);
    await waitFor(() => expect(screen.getByRole('button', { name: 'ยกเลิก' })).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    await waitFor(() => expect(openBtn).toHaveFocus());
  });
});
