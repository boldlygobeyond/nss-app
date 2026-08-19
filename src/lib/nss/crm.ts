const INTERNAL_EMAIL_DOMAIN = "@boldlygobeyond.com";

// Best-effort CRM lead sync — lead capture/enrichment is a side effect of
// onboarding and report generation, not a requirement for either to
// succeed, so failures here are only ever logged, never thrown.
export async function notifyCrmLead(payload: {
  firstName: string;
  lastName: string;
  email: string;
  sourceParam?: string | null;
  reportUrl?: string | null;
}): Promise<void> {
  // Internal team members aren't leads — don't clutter the CRM tracking
  // our own staff's test/dogfooding submissions.
  if (payload.email.toLowerCase().endsWith(INTERNAL_EMAIL_DOMAIN)) {
    return;
  }
  if (!process.env.CRM_LEAD_INTAKE_API_KEY) {
    console.warn("[crm] CRM_LEAD_INTAKE_API_KEY not set, skipping CRM lead sync");
    return;
  }
  try {
    const res = await fetch("https://crm.boldlygobeyond.com/api/leads/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.CRM_LEAD_INTAKE_API_KEY,
      },
      body: JSON.stringify({
        firstName: payload.firstName,
        lastName: payload.lastName,
        email: payload.email,
        ...(payload.sourceParam ? { sourceParam: payload.sourceParam } : {}),
        ...(payload.reportUrl ? { reportUrl: payload.reportUrl } : {}),
      }),
    });
    if (!res.ok) {
      console.error("[crm] lead intake failed:", res.status, await res.text());
    }
  } catch (error) {
    console.error("[crm] lead intake error:", error);
  }
}
