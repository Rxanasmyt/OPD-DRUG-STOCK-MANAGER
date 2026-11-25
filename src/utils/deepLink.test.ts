import { describe, it, expect, beforeEach } from 'vitest';
import { parseReturnsDeepLink, captureReturnsDeepLink, hasReturnsDeepLink, takeReturnsDeepLink } from './deepLink';

describe('returns deep link', () => {
  beforeEach(() => { sessionStorage.clear(); window.history.replaceState(null, '', '/'); });

  it('parses month and view; unknown view falls back to all; bad month is rejected', () => {
    expect(parseReturnsDeepLink('?r=returns&m=2026-10&v=cat')).toEqual({ month: '2026-10', view: 'cat' });
    expect(parseReturnsDeepLink('?r=returns&m=2026-10&v=zzz')).toEqual({ month: '2026-10', view: 'all' });
    expect(parseReturnsDeepLink('?r=returns&m=2026-13')).toBeNull();
    expect(parseReturnsDeepLink('?r=returns&m=<script>')).toBeNull();
    expect(parseReturnsDeepLink('?r=other&m=2026-10')).toBeNull();
    expect(parseReturnsDeepLink('')).toBeNull();
  });

  it('capture parks the link, strips only its own params from the address bar, and take consumes it once', () => {
    window.history.replaceState(null, '', '/OPD/?keep=1&r=returns&m=2026-10&v=reason#x');
    captureReturnsDeepLink();
    expect(window.location.search).toBe('?keep=1');
    expect(window.location.hash).toBe('#x');
    expect(hasReturnsDeepLink()).toBe(true);
    expect(takeReturnsDeepLink()).toEqual({ month: '2026-10', view: 'reason' });
    expect(hasReturnsDeepLink()).toBe(false);
    expect(takeReturnsDeepLink()).toBeNull();
  });

  it('an ordinary URL is left alone', () => {
    window.history.replaceState(null, '', '/OPD/?foo=bar');
    captureReturnsDeepLink();
    expect(window.location.search).toBe('?foo=bar');
    expect(hasReturnsDeepLink()).toBe(false);
  });
});
