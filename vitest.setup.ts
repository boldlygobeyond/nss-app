import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Without this, each render() in a React Testing Library test appends to
// the document rather than resetting it, so an earlier test's leftover
// (and now handler-less) DOM nodes can get matched by a later test's own
// queries — surfaced here as "multiple elements found" and clicks on a
// stale node silently doing nothing.
afterEach(() => {
  cleanup();
});
