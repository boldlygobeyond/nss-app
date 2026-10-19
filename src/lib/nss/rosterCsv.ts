export interface RosterRow {
  firstName: string;
  lastName: string;
  email: string;
  managerEmail: string;
}

// Minimal CSV parser — handles quoted fields (so a name with a comma in it
// doesn't break), nothing fancier. Good enough for a 4-column roster sheet;
// not meant as a general CSV library.
function parseCsvLines(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

// Accepts a few spellings of each header so a human copy-pasting into a
// spreadsheet doesn't have to match an exact string.
const HEADER_ALIASES: Record<keyof RosterRow, string[]> = {
  firstName: ["first_name", "first name", "firstname"],
  lastName: ["last_name", "last name", "lastname"],
  email: ["email", "email address"],
  managerEmail: ["manager_email", "manager email", "manager's email", "managers email"],
};

export function parseRosterCsv(text: string): { rows: RosterRow[]; errors: string[] } {
  return rosterRowsFromGrid(parseCsvLines(text.trim()));
}

// Same validation/column-matching as parseRosterCsv, but for data that's
// already a 2D array — what the Google Sheets API returns directly, no CSV
// text involved, so the "select from Drive" path reuses every rule here
// (required columns, blank/invalid-email handling) instead of duplicating it.
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
