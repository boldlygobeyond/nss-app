// Server-side PDF rendering — launches headless Chromium (a locally
// installed Chrome in dev, since @sparticuz/chromium's bundled binary is
// Linux-only and won't run on a Mac/Windows dev machine; the serverless
// binary in production) and renders the report's own print pages to a PDF
// using the browser's real print-CSS engine. This reuses the exact same
// design as the on-screen report with zero duplicate styling work, instead
// of hand-building a second, simpler layout in a PDF library.
//
// Single capture of /print/combined (cover immediately followed by the
// body, in one page load) — not two separate captures merged together.
// The old two-capture approach existed only to give the cover zero
// footer; now that the cover has a real footer, there's nothing left for
// the split to buy, and it was the direct cause of both halves
// independently starting their page count at 1.

import puppeteer, { type Browser, type Page } from "puppeteer-core";

const DEV_CHROME_PATH =
  process.env.CHROME_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const DEFAULT_VIEWPORT = { width: 1240, height: 1754, deviceScaleFactor: 1 };

async function launchBrowser(viewport: { width: number; height: number; deviceScaleFactor: number }): Promise<Browser> {
  if (process.env.NODE_ENV !== "production") {
    return puppeteer.launch({
      executablePath: DEV_CHROME_PATH,
      headless: true,
      defaultViewport: viewport,
    });
  }

  const chromium = (await import("@sparticuz/chromium")).default;
  return puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    defaultViewport: viewport,
    executablePath: await chromium.executablePath(),
    headless: "shell",
  });
}

async function openAuthenticatedPage(
  browser: Browser,
  url: string,
  cookies: { name: string; value: string }[],
  waitForSelector?: string,
): Promise<Page> {
  const page = await browser.newPage();
  const origin = new URL(url).origin;
  if (cookies.length > 0) {
    await page.setCookie(...cookies.map((c) => ({ ...c, url: origin })));
  }
  await page.emulateMediaType("print");
  await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  // Some capture targets (e.g. the Team Snapshot print page) finish their
  // own client-side measure-then-layout pass slightly after the network
  // goes idle — wait for their own readiness marker instead of racing it.
  if (waitForSelector) {
    await page.waitForSelector(waitForSelector, { timeout: 10000 });
  }
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
    <div style="width:100%; font-size:11px; color:#6b7280; font-family:Arial,Helvetica,sans-serif; padding:0 0.6in;">
      <div style="border-top:1px solid #d1d5db; width:45%; margin:0 auto 8px auto;"></div>
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <img src="${logoDataUri}" style="height:18px;" />
        <a href="https://boldlygobeyond.com" style="color:#6b7280; text-decoration:none;">www.boldlygobeyond.com</a>
        <span class="pageNumber"></span>
      </div>
    </div>
  `;
}

// Single continuous capture of /print/combined. Cookies authenticate the
// request as the real user — no separate auth-bypass mechanism, RLS just
// works as it would normally.
export async function renderReportPdf(params: {
  url: string;
  cookies: { name: string; value: string }[];
  waitForSelector?: string;
  margin?: { top?: string; bottom?: string; left?: string; right?: string };
  landscape?: boolean;
  // Switches the browser's own viewport to match the physical page's
  // content box (in px at 96dpi) instead of the default 1240x1754 —
  // Puppeteer's print pass reflows purely against the target page size,
  // invisibly to the page's own script, so any client-side layout math
  // that calls getBoundingClientRect() (e.g. a chart placing labels to
  // avoid overlap) would otherwise measure the wrong — much wider —
  // viewport and get the wrong answer for what will actually print.
  // Matching the viewport up front keeps what the page measures and what
  // finally prints in sync. Independent of fitHeightToOnePage below: a
  // multi-page capture can still need accurate per-page measurement.
  matchViewportToPage?: boolean;
  // When true, measures the page's actual rendered height and shrinks the
  // whole capture (Puppeteer's own print `scale`) just enough to guarantee
  // it lands on one physical page — rather than hand-tuning the content's
  // own CSS to guess at a page budget that only holds for some team sizes.
  // Left off for anything deliberately multi-page.
  fitHeightToOnePage?: boolean;
}): Promise<Buffer> {
  const margin = {
    top: params.margin?.top ?? "0.6in",
    bottom: params.margin?.bottom ?? "0.85in",
    left: params.margin?.left ?? "0.6in",
    right: params.margin?.right ?? "0.6in",
  };
  const pageWidthIn = params.landscape ? 11 : 8.5;
  const pageHeightIn = params.landscape ? 8.5 : 11;
  const contentWidthPx = (pageWidthIn - parseFloat(margin.left) - parseFloat(margin.right)) * 96;
  const availableHeightPx = (pageHeightIn - parseFloat(margin.top) - parseFloat(margin.bottom)) * 96;

  const viewport = params.matchViewportToPage
    ? { width: Math.round(contentWidthPx), height: 3000, deviceScaleFactor: 1 }
    : DEFAULT_VIEWPORT;

  const browser = await launchBrowser(viewport);
  try {
    const origin = new URL(params.url).origin;
    const logoDataUri = await fetchAsDataUri(`${origin}/logo/bgb-star.png`);

    const page = await openAuthenticatedPage(browser, params.url, params.cookies, params.waitForSelector);

    let scale = 1;
    if (params.fitHeightToOnePage) {
      const naturalHeightPx = await page.evaluate(() => document.documentElement.scrollHeight);
      if (naturalHeightPx > availableHeightPx) {
        // A hair under the exact ratio — leaves a small safety margin so
        // sub-pixel rounding during Chrome's own print layout pass can
        // never push it back over by a line.
        scale = Math.max(0.5, (availableHeightPx / naturalHeightPx) * 0.98);
      }
    }

    const pdf = await page.pdf({
      format: "letter",
      landscape: params.landscape,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: buildFooterTemplate(logoDataUri),
      margin,
      scale,
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
