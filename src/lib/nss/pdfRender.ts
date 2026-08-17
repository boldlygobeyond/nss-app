// Server-side PDF rendering — launches headless Chromium (a locally
// installed Chrome in dev, since @sparticuz/chromium's bundled binary is
// Linux-only and won't run on a Mac/Windows dev machine; the serverless
// binary in production) and renders the report's own print page to a PDF
// using the browser's real print-CSS engine. This reuses the exact same
// design as the on-screen report with zero duplicate styling work, instead
// of hand-building a second, simpler layout in a PDF library.

import puppeteer, { type Browser, type Page } from "puppeteer-core";

const DEV_CHROME_PATH =
  process.env.CHROME_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function launchBrowser(): Promise<Browser> {
  if (process.env.NODE_ENV !== "production") {
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

// Renders the report's print page as a single footered, numbered PDF —
// cookies authenticate the request as the real user, no separate
// auth-bypass mechanism, RLS just works as it would normally.
export async function renderReportPdf(params: {
  url: string;
  cookies: { name: string; value: string }[];
}): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const origin = new URL(params.url).origin;
    const logoDataUri = await fetchAsDataUri(`${origin}/logo/bgb-star.png`);

    const page = await openAuthenticatedPage(browser, params.url, params.cookies);
    const pdf = await page.pdf({
      format: "a4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: buildFooterTemplate(logoDataUri),
      margin: { top: "15mm", bottom: "22mm", left: "15mm", right: "15mm" },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
