// respondent_name is only ever a first name (the survey greeting asks for
// "your first name" and prefills from the profile) — everywhere the
// person's identity is actually displayed should prefer the profile's real
// first+last name and fall back to respondent_name only if the profile
// hasn't loaded or is incomplete.
export function buildFullName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallbackName: string,
): string {
  return [firstName, lastName].filter(Boolean).join(" ") || fallbackName;
}

export function buildReportFileName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallbackName: string,
  date: string,
): string {
  const name = buildFullName(firstName, lastName, fallbackName);
  const dateStr = new Date(date)
    .toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })
    .replace(/\//g, "-");
  return `${name} - Needs Signal Report ${dateStr}`;
}

// Google Drive archival's own naming convention — date-first so files sort
// chronologically in a folder listing, distinct from buildReportFileName
// above (what a respondent sees when they download their own PDF directly,
// never changed by this request).
export function buildDriveFileName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallbackName: string,
  date: string,
): string {
  const name = buildFullName(firstName, lastName, fallbackName);
  const dateStr = new Date(date)
    .toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })
    .replace(/\//g, "-");
  return `${dateStr} ${name} Needs Signal Report`;
}
