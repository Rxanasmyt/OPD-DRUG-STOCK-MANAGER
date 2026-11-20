// Browser-compatibility guards (iOS Safari / Android WebView / older iPads). A single unsupported token in the
// main bundle makes the WHOLE app fail to load (blank screen) on that device — so these are static guards
// over the shipped source.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function walk(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !p.includes('test-utils')) out.push(p);
  }
  return out;
}
const files = walk('src');
const scan = (re: RegExp) => files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((l, i) => ({ f, i: i + 1, l })).filter((x) => re.test(x.l) && !/^\s*(\/\/|\*)/.test(x.l)).map((x) => x.f + ':' + x.i));

describe('browser compatibility (static guards)', () => {
  it('no regex lookbehind — Safari/iOS < 16.4 throws a SyntaxError and the app never loads', () => {
    expect(scan(/\(\?<[=!]/)).toEqual([]);
  });
  it('no APIs missing on iOS 15.0–15.3 / older Android WebView', () => {
    expect(scan(/\.(at|findLast|findLastIndex|toSorted|toReversed|toSpliced)\(|Object\.hasOwn\(|structuredClone\(|Array\.fromAsync|AbortSignal\.timeout\(|\.replaceAll\(/)).toEqual([]);
  });
});
