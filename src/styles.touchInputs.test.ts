// iOS Safari zooms the page when a focused text field is <16px; many fields set small inline sizes, so a coarse-pointer
// !important rule in styles.css must keep covering every text-entry control.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('touch-screen input font size', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  it('forces 16px on inputs/selects/textareas under (pointer: coarse)', () => {
    const m = css.match(/@media \(pointer: coarse\)\s*\{([^}]*\{[^}]*\})\s*\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/font-size:\s*16px\s*!important/);
    expect(m![1]).toMatch(/select/);
    expect(m![1]).toMatch(/textarea/);
  });
});
