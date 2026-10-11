// Regression test for a real audit finding: PromptDialog had no focus trap and never restored
// focus to the triggering element on close — see ConfirmDialog.focustrap.test.tsx for the full
// reasoning (same fix, same bug class BottomSheet.tsx already closed). Initial focus itself was
// already correct here (the input uses native `autoFocus`), so this only covers the trap + the
// restore-on-close.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from '../store/AppContext';
import PromptDialog from './PromptDialog';
import { renderWithApp } from '../test-utils/renderWithApp';

function TriggerHarness() {
  const { promptAsync } = useApp();
  return (
    <>
      <button onClick={() => void promptAsync('พิมพ์เหตุผล')}>open-prompt</button>
      <PromptDialog />
    </>
  );
}

describe('PromptDialog — focus trap & restore regression', () => {
  it('wraps Tab from the last button back to the input, and Shift+Tab from the input to the last button', async () => {
    const user = userEvent.setup();
    renderWithApp(<TriggerHarness />);
    await user.click(screen.getByRole('button', { name: 'open-prompt' }));
    const textbox = await screen.findByRole('textbox');
    await waitFor(() => expect(textbox).toHaveFocus());
    const cancelBtn = screen.getByRole('button', { name: 'ยกเลิก' });
    const confirmBtn = screen.getByRole('button', { name: 'ยืนยัน' });

    // Without the fix, Tab from the last focusable element would walk out of the dialog
    // entirely instead of wrapping back to the input.
    await user.tab();
    expect(cancelBtn).toHaveFocus();
    await user.tab();
    expect(confirmBtn).toHaveFocus();
    await user.tab();
    expect(textbox).toHaveFocus();

    await user.tab({ shift: true });
    expect(confirmBtn).toHaveFocus();
  });

  it('restores focus to the button that opened the dialog, after it closes', async () => {
    const user = userEvent.setup();
    renderWithApp(<TriggerHarness />);
    const openBtn = screen.getByRole('button', { name: 'open-prompt' });
    await user.click(openBtn);
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    await waitFor(() => expect(openBtn).toHaveFocus());
  });
});
