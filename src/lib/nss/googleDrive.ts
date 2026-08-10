// Google Drive archival — findOrCreateFolder/uploadFileToDrive Shared Drive
// logic ported from the Base44 export's uploadNSSReports function, adapted
// to use a service account + googleapis instead of Base44's connector. The
// PDF itself is the same headless-Chromium render used for the in-app
// download (see pdfRender.ts), not a separate simplified copy.

import { google } from "googleapis";

function getDriveClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) {
    throw new Error("Google service account credentials are not configured");
  }

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return google.drive({ version: "v3", auth });
}

async function findOrCreateFolder(
  drive: ReturnType<typeof getDriveClient>,
  name: string,
  parentId: string,
  driveId: string,
): Promise<string> {
  const escapedName = name.replace(/'/g, "\\'");
  const search = await drive.files.list({
    q: `name='${escapedName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    corpora: "drive",
    driveId,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    fields: "files(id, name)",
  });

  if (search.data.files && search.data.files.length > 0) {
    return search.data.files[0].id as string;
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    supportsAllDrives: true,
    fields: "id",
  });

  return created.data.id as string;
}

async function uploadPdf(
  drive: ReturnType<typeof getDriveClient>,
  fileName: string,
  pdfBuffer: Buffer,
  parentId: string,
): Promise<{ id: string; url: string }> {
  const { Readable } = await import("node:stream");
  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [parentId] },
    media: { mimeType: "application/pdf", body: Readable.from(pdfBuffer) },
    supportsAllDrives: true,
    fields: "id",
  });

  const id = res.data.id as string;
  return { id, url: `https://drive.google.com/file/d/${id}/view` };
}

export async function archiveReportToDrive(params: {
  userEmail: string;
  pdfBuffer: Buffer;
}): Promise<{ pdfUrl: string; pdfDriveId: string }> {
  const driveId = process.env.GOOGLE_DRIVE_ID;
  if (!driveId) throw new Error("GOOGLE_DRIVE_ID is not configured");

  const drive = getDriveClient();
  const rootFolderId = await findOrCreateFolder(drive, "NSS_Reports", driveId, driveId);
  const userFolderId = await findOrCreateFolder(drive, params.userEmail, rootFolderId, driveId);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  const file = await uploadPdf(drive, `${params.userEmail}_${timestamp}_NSS_Report.pdf`, params.pdfBuffer, userFolderId);

  return { pdfUrl: file.url, pdfDriveId: file.id };
}
