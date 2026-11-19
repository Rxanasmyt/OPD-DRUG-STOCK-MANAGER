// The category strip used to be 21 long chips in one horizontal scroller. The picker shows the
// current choice in one bar and every non-empty category as a tile on demand.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryPicker } from './CategoryPicker';

describe('CategoryPicker', () => {
  it('opens a grid of only the non-empty categories (with counts), picks one, then closes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CategoryPicker value="all" onChange={onChange} counts={{ pain: 19, cardio: 36, derm: 0 }} total={55} />);
    expect(screen.queryByRole('group', { name: 'เลือกหมวดกลุ่มยา' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /หมวดกลุ่มยา/ }));
    const panel = screen.getByRole('group', { name: 'เลือกหมวดกลุ่มยา' });
    expect(panel).toHaveTextContent('ยาโรคหัวใจ');
    expect(panel).toHaveTextContent('36');
    expect(panel).not.toHaveTextContent('ยาผิวหนัง'); // zero-count category hidden
    await user.click(screen.getByRole('button', { name: /ยาโรคหัวใจ/ }));
    expect(onChange).toHaveBeenCalledWith('cardio');
    expect(screen.queryByRole('group', { name: 'เลือกหมวดกลุ่มยา' })).toBeNull();
  });

  it('shows the active category on the bar with a one-tap clear back to all', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CategoryPicker value="cardio" onChange={onChange} counts={{ cardio: 36 }} total={55} />);
    expect(screen.getByRole('button', { name: /หมวดกลุ่มยา/ })).toHaveTextContent('ยาโรคหัวใจ/หลอดเลือด/ความดัน (36)');
    await user.click(screen.getByRole('button', { name: /ล้างตัวกรองหมวด/ }));
    expect(onChange).toHaveBeenCalledWith('all');
  });
});
