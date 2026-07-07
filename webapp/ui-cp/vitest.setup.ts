// Global Vitest setup: register @testing-library/jest-dom matchers and unmount
// React trees between tests. Not typechecked (outside tsconfig "src") — runtime
// only. Tests themselves use vitest's built-in matchers so `tsc --noEmit` stays
// clean without extra global type wiring.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
