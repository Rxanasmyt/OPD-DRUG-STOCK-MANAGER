// The replenishment report must not count a refill the user cancelled.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, hasListener, seedCollection } from '../test-utils/firebaseTestDouble';
import { REVERSAL_PREFIX } from '../utils/returnReasons';
import { isoDate } from '../utils/format';
import { useState } from 'react';

const now = Date.now();
const base = { name: 'X', medId: 'm1', unit: 'เม็ด', by: 'ทดสอบ', ts: now - 3600000 };
function H() {
  const { fetchFloorRefills } = useApp();
  const [out, setOut] = useState('');
  return <><button onClick={async () => { const r = await fetchFloorRefills(isoDate(now - 86400000), isoDate(now)); setOut(r.map((x) => x.id).join(',')); }}>go</button><div data-testid="out">{out || '-'}</div></>;
}
describe('fetchFloorRefills', () => {
  it('drops refills that have a cancel row', async () => {
    renderWithApp(<H />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    seedCollection('txs', [
      { id: 'a', type: 'transfer_to_floor', qty: 10, ...base },
      { id: 'b', type: 'transfer_to_floor', qty: 20, ...base },
      { id: 'r1', type: 'count', qty: -20, loc: 'floor', reason: REVERSAL_PREFIX + 'เติมหน้างาน', note: '#b · ยกเลิกเติมหน้างาน', ...base },
    ]);
    await act(async () => { screen.getByRole('button', { name: 'go' }).click(); });
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('a'));
  });
});
