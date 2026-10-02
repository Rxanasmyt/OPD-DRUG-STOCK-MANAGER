// Regression test for a real request: "รายการที่ต้องเติมหน้างานอยากให้มีชั้นวางโชว์ด้วยครับ
// เพื่อหาตำแหน่งของยาได้อย่างถูกต้อง" — the "เติมหน้างาน" list already sorts by shelf position
// ("ตามชั้นวาง", using binDisplayAll) but never actually printed the bin code on the row itself,
// leaving someone walking the shelf with no way to confirm they're at the right spot. See
// TransferScreen.tsx's own "Real-world request" comment on the bin badge.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import TransferScreen from './TransferScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'C7',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('TransferScreen — shelf-bin badge regression', () => {
  it('shows the shelf bin code on the row', async () => {
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', []);

    await screen.findByText(MED.name);
    expect(screen.getByText('C7')).toBeInTheDocument();
  });
});
