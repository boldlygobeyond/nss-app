export interface RosterRow {
  firstName: string;
  lastName: string;
  email: string;
  managerEmail: string;
}

// Accepts a few spellings of each header so a human copy-pasting into a
// spreadsheet doesn't have to match an exact string.
const HEADER_ALIASES: Record<keyof RosterRow, string[]> = {
  firstName: ["first_name", "first name", "firstname"],
  lastName: ["last_name", "last name", "lastname"],
  email: ["email", "email address"],
  managerEmail: ["manager_email", "manager email", "manager's email", "managers email"],
};

// Validates and maps a 2D grid of cells (header row + data rows) into
// roster entries — what the Google Sheets API returns directly.
export function rosterRowsFromGrid(lines: string[][]): { rows: RosterRow[]; errors: string[] } {
  if (lines.length === 0) return { rows: [], errors: ["The sheet is empty."] };

  const header = lines[0].map((h) => (h ?? "").trim().toLowerCase());
  const colIndex = {} as Record<keyof RosterRow, number>;
  const missing: string[] = [];
  (Object.keys(HEADER_ALIASES) as (keyof RosterRow)[]).forEach((key) => {
    const idx = header.findIndex((h) => HEADER_ALIASES[key].includes(h));
    if (idx === -1) missing.push(key);
    else colIndex[key] = idx;
  });
  if (missing.length > 0) {
    return { rows: [], errors: [`Missing column(s): ${missing.join(", ")}. Expected first_name, last_name, email, manager_email.`] };
  }

  const rows: RosterRow[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, i) => {
    const firstName = (line[colIndex.firstName] ?? "").trim();
    const lastName = (line[colIndex.lastName] ?? "").trim();
    const email = (line[colIndex.email] ?? "").trim().toLowerCase();
    const managerEmail = (line[colIndex.managerEmail] ?? "").trim().toLowerCase();
    const rowNum = i + 2; // +1 for header, +1 for 1-indexing
    if (!firstName || !lastName || !email || !managerEmail) {
      errors.push(`Row ${rowNum}: missing a required value, skipped.`);
      return;
    }
    if (!email.includes("@") || !managerEmail.includes("@")) {
      errors.push(`Row ${rowNum}: email doesn't look valid, skipped.`);
      return;
    }
    rows.push({ firstName, lastName, email, managerEmail });
  });

  return { rows, errors };
}
