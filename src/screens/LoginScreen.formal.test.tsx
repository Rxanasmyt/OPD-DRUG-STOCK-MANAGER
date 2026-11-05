// Real-world request: "ปรับหน้า LOGIN ให้ดูสวยงามที่สุด เพิ่ม Animation CSS ล้ำสมัย" — reverses an
// earlier formality-driven pass (see git history: that version removed a bouncy crest entrance, a
// pulsing glow ring, a shimmering top accent bar, and the online-status dot's pulse, and scoped
// a `.mesh-bg--static` modifier to Login specifically, because "อยากปรับให้หน้า login ดูทางการ
// สำหรับใช้ในรพ." asked for a steadier, more document-like tone). The new request explicitly asks
// for the opposite — maximum polish, modern motion — so this test now locks in the ANIMATED
// state instead: the crest pops in and keeps a slow ambient glow, the top accent bar and the
// glass card both carry a light-sweep shimmer, the online dot pulses while connected, and the
// shared .mesh-bg blobs drift on Login the same way they already do in App.tsx's header.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import LoginScreen from './LoginScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { fireAuth } from '../test-utils/firebaseTestDouble';

describe('LoginScreen — polished/animated tone regression', () => {
  it('uses the animated crest, accent bar, card sheen and drifting mesh-bg instead of the old static tone', async () => {
    const { container } = renderWithApp(<LoginScreen />);
    fireAuth(null); // settles authStatus: 'loading' -> 'signedOut'
    await waitFor(() => expect(screen.getByText('KPNHOS')).toBeInTheDocument());

    const html = container.innerHTML;
    // Crest: spring "pop" entrance + ambient glow ring.
    expect(html).toMatch(/animation[^"]*:\s*['"]?pop /);
    expect(html).toContain('glowPulse');
    // Top accent bar + glass card both carry the shared tile-sheen/tile-shimmer treatment.
    expect(container.querySelectorAll('.tile-sheen').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.tile-shimmer').length).toBeGreaterThan(0);

    // mesh-bg now drifts on Login too — no --static modifier scoping it down anymore.
    const meshLayers = container.querySelectorAll('.mesh-bg');
    expect(meshLayers.length).toBeGreaterThan(0);
    meshLayers.forEach((el) => expect(el.className).not.toContain('mesh-bg--static'));
  });

  it("pulses the online-status dot while connected, but keeps it steady when offline (a dead connection shouldn't look alive)", async () => {
    renderWithApp(<LoginScreen />);
    fireAuth(null);
    await waitFor(() => expect(screen.getByText('KPNHOS')).toBeInTheDocument());

    const onlineBadge = screen.getByTitle('เชื่อมต่ออินเทอร์เน็ตอยู่');
    const onlineDot = onlineBadge.querySelector('span') as HTMLElement;
    expect(onlineDot).toHaveStyle({ animation: 'pulse 2s ease-in-out infinite' });
  });
});
