// Google Drive archival — ported from the Base44 export's uploadNSSReports /
// regenerateAllUserReports functions (stripMarkdown + jsPDF text-dump, and
// the findOrCreateFolder/uploadFileToDrive Shared Drive logic), adapted to
// use a service account + googleapis instead of Base44's connector.

import { google } from "googleapis";
import { jsPDF } from "jspdf";

function stripMarkdown(text: string): string {
  return (text || "")
    .replace(/#{1,6}\s?/g, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/\|/g, " | ")
    .replace(/^[-=]{3,}$/gm, "")
    .trim();
}

export function generatePdfBuffer(title: string, reportText: string): Buffer {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text(title, 15, 20);
  doc.setFontSize(10);
  const cleaned = stripMarkdown(reportText);
  const lines: string[] = doc.splitTextToSize(cleaned, 180);
  let y = 35;
  lines.forEach((line) => {
    if (y > 275) {
      doc.addPage();
      y = 20;
    }
    doc.text(line, 15, y);
    y += 5;
  });
  return Buffer.from(doc.output("arraybuffer"));
}

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

export async function archiveReportsToDrive(params: {
  userEmail: string;
  respondentName: string;
  employeeText: string;
  managerText: string;
}): Promise<{
  employeePdfUrl: string;
  employeePdfDriveId: string;
  managerPdfUrl: string;
  managerPdfDriveId: string;
}> {
  const driveId = process.env.GOOGLE_DRIVE_ID;
  if (!driveId) throw new Error("GOOGLE_DRIVE_ID is not configured");

  const drive = getDriveClient();
  const rootFolderId = await findOrCreateFolder(drive, "NSS_Reports", driveId, driveId);
  const userFolderId = await findOrCreateFolder(drive, params.userEmail, rootFolderId, driveId);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  const employeePdf = generatePdfBuffer(
    `Needs Signal Survey Report — ${params.respondentName}`,
    params.employeeText,
  );
  const managerPdf = generatePdfBuffer(`Manager Report: Supporting ${params.respondentName}`, params.managerText);

  const [employeeFile, managerFile] = await Promise.all([
    uploadPdf(drive, `${params.userEmail}_${timestamp}_Employee_NSS.pdf`, employeePdf, userFolderId),
    uploadPdf(drive, `${params.userEmail}_${timestamp}_Manager_NSS.pdf`, managerPdf, userFolderId),
  ]);

  return {
    employeePdfUrl: employeeFile.url,
    employeePdfDriveId: employeeFile.id,
    managerPdfUrl: managerFile.url,
    managerPdfDriveId: managerFile.id,
  };
}
