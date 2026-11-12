// The team's own inbox — BCC'd on every real team-facing send so the
// team can see exactly what went out, with the real recipient's real
// data. Never used for lead-facing sends (first.contact@ owns those).
export const NOVA_APP_EMAIL = "nova.app@boldlygobeyond.com";

// Destination for admin "Send test" actions in the NSS/NRS admin UI.
// Configurable via ADMIN_TEST_EMAIL so a different test inbox can be used
// without touching code; defaults to testing@boldlygobeyond.com (a group
// Marc created for this) per his own instruction — change the default
// only if he says to. Read at call time, not module load, so it can
// change without a redeploy — same reasoning as respondentEmail.ts's
// CALENDAR_BOOKING_URL. Routes must always use this function for the
// test recipient, never a client-supplied address.
export function getAdminTestEmail(): string {
  return process.env.ADMIN_TEST_EMAIL || "testing@boldlygobeyond.com";
}
