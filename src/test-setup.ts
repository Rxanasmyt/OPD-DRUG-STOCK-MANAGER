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

// jsdom has no ResizeObserver implementation at all — real browsers do, so this only ever
// surfaces here. LabelsScreen's AutoFitText/AutoFitTitle (font-size-to-fit-box measurement)
// construct one on mount, which throws "ResizeObserver is not defined" and crashes any test
// that renders that screen without this stub. A no-op is fine: these tests never resize the
// jsdom viewport mid-test, so the fit-callback firing once on mount (main.tsx's real code
// still reads clientWidth itself) is all any test here needs.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

// @testing-library/react's auto-cleanup-after-each-test only self-registers when it detects a
// Jest-style global `afterEach` — this project's vitest config doesn't set `globals: true`
// (each test file explicitly imports describe/it/expect instead), so that auto-registration
// never fires and every test's rendered tree was piling up in the same jsdom document as the
// next test's. Wiring both cleanups explicitly here, once, covers every test file.
afterEach(() => {
  cleanup();
  resetFirebaseTestDouble();
});
