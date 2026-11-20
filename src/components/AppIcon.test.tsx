import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import AppIcon from './AppIcon';

describe('AppIcon', () => {
  it('loads the icon relative to the app base path (live site is served from a sub-path)', () => {
    const { container } = render(<AppIcon size={44} />);
    const src = container.querySelector('img')!.getAttribute('src')!;
    expect(src).toBe(import.meta.env.BASE_URL + 'icon-192.png');
    expect(src.endsWith('icon-192.png')).toBe(true);
  });
});
