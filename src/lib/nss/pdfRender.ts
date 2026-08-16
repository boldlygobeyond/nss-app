// Server-side PDF rendering — launches headless Chromium (a locally
// installed Chrome in dev, since @sparticuz/chromium's bundled binary is
// Linux-only and won't run on a Mac/Windows dev machine; the serverless
// binary in production) and renders the report's own print pages to a PDF
// using the browser's real print-CSS engine. This reuses the exact same
// design as the on-screen report with zero duplicate styling work, instead
// of hand-building a second, simpler layout in a PDF library.
//
// The cover page and the report body are captured as two separate PDFs and
// merged, because Puppeteer's header/footer templates apply uniformly to
// every page with no way to skip the first one — this is the only reliable
// way to get an unnumbered, footer-free cover page alongside a footered,
// numbered body.

import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { PDFDocument } from "pdf-lib";

const DEV_CHROME_PATH =
  process.env.CHROME_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function launchBrowser(): Promise<Browser> {
  if (process.env.NODE_ENV !== "production") {
    // Match production's viewport — layouts using vh-based "pin to the
    // bottom of the page" tricks (the cover page's intro box) render
    // against whatever viewport is active, and Puppeteer's 800x600 default
    // doesn't match an A4 page's proportions the way this one does.
    return puppeteer.launch({
      executablePath: DEV_CHROME_PATH,
      headless: true,
      defaultViewport: { width: 1240, height: 1754, deviceScaleFactor: 1 },
    });
  }

  const chromium = (await import("@sparticuz/chromium")).default;
  return puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    defaultViewport: { width: 1240, height: 1754, deviceScaleFactor: 1 },
    executablePath: await chromium.executablePath(),
    headless: "shell",
  });
}

async function openAuthenticatedPage(
  browser: Browser,
  url: string,
  cookies: { name: string; value: string }[],
): Promise<Page> {
  const page = await browser.newPage();
  const origin = new URL(url).origin;
  if (cookies.length > 0) {
    await page.setCookie(...cookies.map((c) => ({ ...c, url: origin })));
  }
  await page.emulateMediaType("print");
  await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function fetchAsDataUri(url: string): Promise<string> {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "image/png";
  return `data:${contentType};base64,${buf.toString("base64")}`;
}

function buildFooterTemplate(logoDataUri: string): string {
  // Puppeteer renders header/footer templates in an isolated context — no
  // external stylesheet, so every style has to be inline. `pageNumber` is
  // one of the few dynamic values Puppeteer substitutes automatically.
  return `
    <div style="width:100%; font-size:11px; color:#6b7280; font-family:Arial,Helvetica,sans-serif; padding:0 15mm;">
      <div style="border-top:1px solid #d1d5db; width:45%; margin:0 auto 8px auto;"></div>
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <img src="${logoDataUri}" style="height:18px;" />
        <a href="https://boldlygobeyond.com" style="color:#6b7280; text-decoration:none;">www.boldlygobeyond.com</a>
        <span class="pageNumber"></span>
      </div>
    </div>
  `;
}

async function mergePdfs(buffers: Buffer[]): Promise<Buffer> {
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    const doc = await PDFDocument.load(buf);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return Buffer.from(await merged.save());
}

// Renders a cover page (no footer/page number) and the report body
// (footered, numbered, starting at 1) as two separate captures and merges
// them into one PDF. Cookies authenticate both requests as the real user —
// no separate auth-bypass mechanism, RLS just works as it would normally.
export async function renderReportPdf(params: {
  coverUrl: string;
  bodyUrl: string;
  cookies: { name: string; value: string }[];
}): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const origin = new URL(params.bodyUrl).origin;
    const logoDataUri = await fetchAsDataUri(`${origin}/logo/bgb-star.png`);

    const coverPage = await openAuthenticatedPage(browser, params.coverUrl, params.cookies);
    const coverPdf = await coverPage.pdf({
      format: "a4",
      printBackground: true,
      margin: { top: "15mm", bottom: "15mm", left: "15mm", right: "15mm" },
    });

    const bodyPage = await openAuthenticatedPage(browser, params.bodyUrl, params.cookies);
    const bodyPdf = await bodyPage.pdf({
      format: "a4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: buildFooterTemplate(logoDataUri),
      margin: { top: "15mm", bottom: "22mm", left: "15mm", right: "15mm" },
    });

    return await mergePdfs([Buffer.from(coverPdf), Buffer.from(bodyPdf)]);
  } finally {
    await browser.close();
  }
}
