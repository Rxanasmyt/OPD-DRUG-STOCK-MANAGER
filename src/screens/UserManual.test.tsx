// The login page offers the full manual + a flow map; manual tab names must be real nav tabs.
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UserManual, { MANUAL_SECTIONS } from './UserManual';
import LoginFlow, { FLOW_NODES } from './LoginFlow';
import LoginScreen from './LoginScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { fireAuth } from '../test-utils/firebaseTestDouble';

describe('UserManual', () => {
  it('is portaled to <body> so it is never under the bottom nav when opened from the เพิ่มเติม tab', () => {
    const { container } = render(<div className="work-screen"><UserManual onClose={() => {}} /></div>);
    const overlay = screen.getByTestId('user-manual');
    expect(overlay.parentElement).toBe(document.body);
    expect(container.contains(overlay)).toBe(false);
  });

  it('has a table of contents entry for every section and closes with the button / Escape', async () => {
    const user = userEvent.setup();
    let closed = 0;
    render(<UserManual onClose={() => { closed++; }} />);
    const toc = screen.getByRole('navigation', { name: 'สารบัญ' });
    expect(toc.querySelectorAll('button').length).toBe(MANUAL_SECTIONS.length);
    for (const s of MANUAL_SECTIONS) expect(document.getElementById('um-' + s.id)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ปิดคู่มือ' }));
    await user.keyboard('{Escape}');
    expect(closed).toBe(2);
  });

  it('uses the literal bottom-nav tab names', () => {
    render(<UserManual onClose={() => {}} />);
    const text = document.body.textContent ?? '';
    for (const t of ['นำเข้า HOSxP', 'เติมหน้างาน', 'รับเข้า', 'เพิ่มเติม', 'หน้าหลัก']) expect(text).toContain(t);
  });

  it('every flow node points at a real manual section', () => {
    const ids = new Set(MANUAL_SECTIONS.map((s) => s.id));
    for (const n of FLOW_NODES) expect(ids.has(n.section)).toBe(true);
    const opened: string[] = [];
    render(<LoginFlow onOpen={(s) => opened.push(s)} />);
    screen.getByTestId('flow-return').click();
    expect(opened).toEqual(['adjust']);
  });
});

describe('LoginScreen — manual entry points', () => {
  it('opens the manual from the button and from a flow node (jumping to that section)', async () => {
    const user = userEvent.setup();
    renderWithApp(<LoginScreen />);
    fireAuth(null);
    await user.click(await screen.findByTestId('open-manual'));
    expect(await screen.findByTestId('user-manual')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ปิดคู่มือ' }));
    await waitFor(() => expect(screen.queryByTestId('user-manual')).not.toBeInTheDocument());
    await user.click(screen.getByTestId('flow-node-sub'));
    expect(await screen.findByTestId('user-manual')).toBeInTheDocument();
  });
});
