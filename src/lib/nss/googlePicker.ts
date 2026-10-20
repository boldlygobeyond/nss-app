"use client";

// Lets an admin pick a Google Sheet (instead of exporting/uploading a CSV)
// for the team roster. Uses Google Identity Services for the OAuth token
// (the drive.file scope — only grants access to whatever file the person
// explicitly picks, not their whole Drive) and the Picker library for the
// actual file-selection UI, then reads the sheet directly via the Sheets
// API. Both libraries are loaded as plain <script> tags since neither
// ships an npm package meant for this kind of client-only usage.

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
}

interface GooglePickerDoc {
  id: string;
  name: string;
}

interface GooglePickerResponse {
  action: string;
  docs?: GooglePickerDoc[];
}

interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (resp: GoogleTokenResponse) => void;
      }): { requestAccessToken(): void };
    };
  };
  picker: {
    PickerBuilder: new () => GooglePickerBuilder;
    ViewId: { SPREADSHEETS: unknown };
    Action: { PICKED: string; CANCEL: string };
  };
}

interface GooglePickerBuilder {
  addView(view: unknown): GooglePickerBuilder;
  setOAuthToken(token: string): GooglePickerBuilder;
  setCallback(cb: (data: GooglePickerResponse) => void): GooglePickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

interface GapiGlobal {
  load(api: string, callback: () => void): void;
}

declare global {
  interface Window {
    google?: GoogleGlobal;
    gapi?: GapiGlobal;
  }
}

// drive.file covers the Picker itself and the parent-folder lookup;
// reading the sheet's actual cell values goes through the separate Sheets
// API, which needs its own scope — drive.file alone isn't honored there.
const SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets.readonly";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

let scriptsPromise: Promise<void> | null = null;

function loadGoogleScripts(): Promise<void> {
  if (!scriptsPromise) {
    scriptsPromise = Promise.all([
      loadScript("https://accounts.google.com/gsi/client"),
      loadScript("https://apis.google.com/js/api.js"),
    ]).then(
      () =>
        new Promise<void>((resolve) => {
          window.gapi!.load("picker", () => resolve());
        }),
    );
  }
  return scriptsPromise;
}

function requestAccessToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      reject(new Error("Google integration isn't configured yet."));
      return;
    }
    const tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) reject(new Error(resp.error || "No access token returned"));
        else resolve(resp.access_token);
      },
    });
    tokenClient.requestAccessToken();
  });
}

function openPicker(accessToken: string): Promise<GooglePickerDoc | null> {
  return new Promise((resolve) => {
    const google = window.google!;
    const picker = new google.picker.PickerBuilder()
      .addView(google.picker.ViewId.SPREADSHEETS)
      .setOAuthToken(accessToken)
      .setCallback((data: GooglePickerResponse) => {
        if (data.action === google.picker.Action.PICKED && data.docs?.[0]) {
          resolve(data.docs[0]);
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

async function fetchSheetGrid(spreadsheetId: string, accessToken: string): Promise<string[][]> {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!metaRes.ok) throw new Error("Could not read that spreadsheet.");
  const meta = (await metaRes.json()) as { sheets?: { properties?: { title?: string } }[] };
  const firstSheetTitle = meta.sheets?.[0]?.properties?.title;
  if (!firstSheetTitle) throw new Error("That spreadsheet has no sheets.");

  const valuesRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(firstSheetTitle)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!valuesRes.ok) throw new Error("Could not read that sheet's data.");
  const values = (await valuesRes.json()) as { values?: string[][] };
  return values.values ?? [];
}

// Non-fatal if this fails — the rest of the pick (roster rows) still works
// without a folder id, it just means reports fall back to the default
// archive location instead of landing next to the sheet. But a silent
// `return null` here left that failure completely invisible, so it's
// logged loudly enough to actually debug if it happens again.
async function fetchParentFolderId(fileId: string, accessToken: string): Promise<string | null> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    console.error("[googlePicker] parent folder lookup failed:", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = (await res.json()) as { parents?: string[] };
  if (!data.parents?.[0]) {
    console.error("[googlePicker] parent folder lookup returned no parents:", JSON.stringify(data));
  }
  return data.parents?.[0] ?? null;
}

export async function pickRosterFromGoogleSheets(): Promise<
  { grid: string[][]; fileName: string; folderId: string | null; spreadsheetId: string } | null
> {
  await loadGoogleScripts();
  const accessToken = await requestAccessToken();
  const doc = await openPicker(accessToken);
  if (!doc) return null;
  const [grid, folderId] = await Promise.all([
    fetchSheetGrid(doc.id, accessToken),
    fetchParentFolderId(doc.id, accessToken),
  ]);
  return { grid, fileName: doc.name, folderId, spreadsheetId: doc.id };
}

// Re-reads a sheet already picked earlier (its id stored on the team) —
// used by "resync from sheet," which shouldn't make the admin pick the
// file again just to pull in corrections someone made since the last sync.
// Also re-attempts the folder lookup, so a team whose folder capture
// failed on the original pick (see fetchParentFolderId above) gets a
// chance to pick it up on the next resync instead of being stuck.
export async function fetchRosterGridForSpreadsheet(
  spreadsheetId: string,
): Promise<{ grid: string[][]; folderId: string | null }> {
  await loadGoogleScripts();
  const accessToken = await requestAccessToken();
  const [grid, folderId] = await Promise.all([
    fetchSheetGrid(spreadsheetId, accessToken),
    fetchParentFolderId(spreadsheetId, accessToken),
  ]);
  return { grid, folderId };
}
