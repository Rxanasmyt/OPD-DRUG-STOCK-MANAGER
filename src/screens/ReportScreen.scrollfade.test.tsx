// Regression for the report-picker redesign (real-world request: choosing a report category was
// "ใช้งานยากมาก"). The old strip had 11 chips in one horizontal scroller where only ~3 fit on a
// phone and nothing grouped them. Now every report is a visible tile grouped under a colour-coded
// category — no horizontal scroller, so nothing can be hidden off-screen.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportScreen from './ReportScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

describe('ReportScreen — grouped report picker', () => {
  it('shows all 11 reports at once, grouped in 4 categories, with no horizontal scroller', async () => {
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', []);
    fireCollection('lots', []);

    const picker = await screen.findByTestId('report-picker');
    expect(picker.querySelectorAll('section')).toHaveLength(4);
    expect(within(picker).getAllByRole('button')).toHaveLength(11);
    expect(picker.querySelector('.scroll-fade-x')).toBeNull();
    const first = await screen.findByRole('button', { name: /ภาพรวมผู้บริหาร/ });
    await userEvent.setup().click(first);
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('report-now')).toHaveTextContent('ภาพรวมผู้บริหาร');
  });
});
