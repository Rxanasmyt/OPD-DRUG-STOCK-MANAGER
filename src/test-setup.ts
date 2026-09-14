// Global vitest setup — loaded once via vite.config.ts's test.setupFiles. Adds jest-dom's
// DOM-specific matchers (toBeInTheDocument, toBeDisabled, etc.) to every test file's `expect`
// without each one having to import it individually.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Registers the firebase/auth + firebase/firestore + ../firebase mocks for the whole test
// run — see firebaseTestDouble.ts's own doc comment for why this is not optional: without it,
// any test that imports AppContext.tsx (directly or via a screen) would try to talk to the
// real production Firestore project.
import { resetFirebaseTestDouble } from './test-utils/firebaseTestDouble';

// @testing-library/react's auto-cleanup-after-each-test only self-registers when it detects a
// Jest-style global `afterEach` — this project's vitest config doesn't set `globals: true`
// (each test file explicitly imports describe/it/expect instead), so that auto-registration
// never fires and every test's rendered tree was piling up in the same jsdom document as the
// next test's. Wiring both cleanups explicitly here, once, covers every test file.
afterEach(() => {
  cleanup();
  resetFirebaseTestDouble();
});
