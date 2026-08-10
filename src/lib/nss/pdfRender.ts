// Server-side PDF rendering — launches headless Chromium (a locally
// installed Chrome in dev, since @sparticuz/chromium's bundled binary is
// Linux-only and won't run on a Mac/Windows dev machine; the serverless
// binary in production) and renders the report's own print page to a PDF
// using the browser's real print-CSS engine. This reuses the exact same
// design as the on-screen report with zero duplicate styling work, instead
// of hand-building a second, simpler layout in a PDF library.

import puppeteer, { type Browser } from "puppeteer-core";

const DEV_CHROME_PATH =
  process.env.CHROME_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function launchBrowser(): Promise<Browser> {
  if (process.env.NODE_ENV !== "production") {
    return puppeteer.launch({ executablePath: DEV_CHROME_PATH, headless: true });
  }

  const chromium = (await import("@sparticuz/chromium")).default;
  return puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    defaultViewport: { width: 1240, height: 1754, deviceScaleFactor: 1 },
    executablePath: await chromium.executablePath(),
    headless: "shell",
  });
}

// Renders `url` to a PDF buffer, presenting it with the given cookies so
// the request is authenticated as whichever real user's session they came
// from — no separate auth-bypass mechanism needed, RLS just works exactly
// as it would for that user browsing normally.
export async function renderUrlToPdf(
  url: string,
  cookies: { name: string; value: string }[],
): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const origin = new URL(url).origin;
    if (cookies.length > 0) {
      await page.setCookie(...cookies.map((c) => ({ ...c, url: origin })));
    }
    await page.emulateMediaType("print");
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    const pdfBytes = await page.pdf({
      format: "a4",
      printBackground: true,
      margin: { top: "15mm", bottom: "15mm", left: "15mm", right: "15mm" },
    });
    return Buffer.from(pdfBytes);
  } finally {
    await browser.close();
  }
}
