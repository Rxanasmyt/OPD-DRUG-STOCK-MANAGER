// Real-world request: "อยากปรับให้หน้า login ดูทางการสำหรับใช้ในรพ." — LoginScreen.tsx used four
// ambient/looping motion cues (a bouncy spring "pop" on the crest, a pulsing glow ring around it,
// a continuously-shifting shimmer on the card's top hairline, a pulsing "online" status dot, plus
// the shared .mesh-bg blobs drifting) that read as playful consumer-app chrome rather than the
// steady, document-like tone a hospital record system wants. Fixed by switching the crest to a
// plain one-time fade (no bounce, no looping glow), freezing the card's top accent to a static
// two-tone bar, removing the online dot's pulse, and adding a login-only .mesh-bg--static modifier
// (the shared .mesh-bg class is also App.tsx's header on every other screen, which keeps its
// drift — this fix is scoped to Login only, per the request). This test locks in that none of
// these elements reference the old looping animation names.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import LoginScreen from './LoginScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { fireAuth } from '../test-utils/firebaseTestDouble';

describe('LoginScreen — formal/institutional tone regression', () => {
  it('never references the old bouncy/pulsing/shimmering animation names, and scopes the static mesh-bg to Login only', async () => {
    const { container } = renderWithApp(<LoginScreen />);
    fireAuth(null); // settles authStatus: 'loading' -> 'signedOut'
    await waitFor(() => expect(screen.getByText('KPNHOS')).toBeInTheDocument());

    const html = container.innerHTML;
    expect(html).not.toContain('glowPulse');
    expect(html).not.toContain('aiGradientShift');
    // "pop" as an animation NAME (not inside unrelated words like "สมัคร" or "ยืนยันตัวตน") — the
    // crest used to run 'pop .5s ...' specifically.
    expect(html).not.toMatch(/animation[^"]*:\s*['"]?pop /);

    const meshLayers = container.querySelectorAll('.mesh-bg');
    expect(meshLayers.length).toBeGreaterThan(0);
    meshLayers.forEach((el) => expect(el.className).toContain('mesh-bg--static'));
  });
});
