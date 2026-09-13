// Shared render helper for screen-level integration tests — wraps a screen in the REAL
// AppProvider (so it exercises the real useApp()/AppContext logic, not a hand-rolled stand-in
// that could drift from what production actually does) with the Firebase SDK swapped for
// firebaseTestDouble.ts underneath. A test drives what "the backend" says via fireCollection()/
// fireDoc()/signInAs() and asserts on what the screen renders in response.
import { render, type RenderResult } from '@testing-library/react';
import { AppProvider } from '../store/AppContext';
import type { ReactElement } from 'react';

export function renderWithApp(ui: ReactElement): RenderResult {
  return render(<AppProvider>{ui}</AppProvider>);
}
