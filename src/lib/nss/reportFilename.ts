export function buildReportFileName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallbackName: string,
  date: string,
): string {
  const name = [firstName, lastName].filter(Boolean).join(" ") || fallbackName;
  const dateStr = new Date(date)
    .toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })
    .replace(/\//g, "-");
  return `${name} - Needs Signal Report ${dateStr}`;
}
