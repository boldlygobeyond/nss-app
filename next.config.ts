import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @sparticuz/chromium is auto-externalized by Next.js, but its bin/
  // folder (the compressed Chromium binary itself) isn't picked up by the
  // default file trace since it's read dynamically at runtime, not
  // imported statically — without this, the deployed function is missing
  // node_modules/@sparticuz/chromium/bin entirely.
  outputFileTracingIncludes: {
    "/api/nss/generate-pdf": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/nss/generate-reports": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
