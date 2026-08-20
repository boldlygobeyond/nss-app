const INTERNAL_EMAIL_DOMAIN = "@boldlygobeyond.com";
const RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postIntake(payload: {
  firstName: string;
  lastName: string;
  email: string;
  sourceParam?: string | null;
  reportUrl?: string | null;
}): Promise<Response> {
  return fetch("https://crm.boldlygobeyond.com/api/leads/intake", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.CRM_LEAD_INTAKE_API_KEY as string,
    },
    body: JSON.stringify({
      firstName: payload.firstName,
      lastName: payload.lastName,
      email: payload.email,
      ...(payload.sourceParam ? { sourceParam: payload.sourceParam } : {}),
      ...(payload.reportUrl ? { reportUrl: payload.reportUrl } : {}),
    }),
  });
}

// Best-effort CRM lead sync — lead capture/enrichment is a side effect of
// onboarding and report generation, not a requirement for either to
// succeed, so failures here are only ever logged, never thrown. One retry
// after a short delay guards against a single transient blip (a redeploy,
// a cold start) silently dropping someone — a real submission went missing
// this way once already — without turning this into a real retry queue.
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

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await postIntake(payload);
      if (res.ok) return;
      const body = await res.text();
      if (attempt === 2) {
        console.error("[crm] lead intake failed after retry:", res.status, body);
        return;
      }
      console.warn("[crm] lead intake failed, retrying once:", res.status, body);
    } catch (error) {
      if (attempt === 2) {
        console.error("[crm] lead intake error after retry:", error);
        return;
      }
      console.warn("[crm] lead intake error, retrying once:", error);
    }
    await sleep(RETRY_DELAY_MS);
  }
}
