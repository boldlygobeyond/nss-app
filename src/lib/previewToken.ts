import { randomBytes } from "node:crypto";

// A token-shaped string for admin "send test" previews — same shape as a
// real access/invite token so the rendered link looks authentic for
// inspection, but never persisted anywhere, so it can't actually be used
// to submit or modify anything on a real participant's behalf (visiting
// it just 404s — nothing in the database has this value).
export function fakePreviewToken(): string {
  return randomBytes(24).toString("hex");
}
