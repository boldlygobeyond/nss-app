import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets `next dev` be reached through a Cloudflare quick tunnel (random
  // *.trycloudflare.com host per run) for testing from devices that can't
  // reach localhost directly. Next's dev server otherwise rejects
  // cross-origin requests (including the HMR websocket) as a DNS-rebinding
  // guard, which is why a tunneled page spins forever without this. Dev-only
  // — has no effect on `next build`/production.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // @sparticuz/chromium is auto-externalized by Next.js, but its bin/
  // folder (the compressed Chromium binary itself) isn't picked up by the
  // default file trace since it's read dynamically at runtime, not
  // imported statically — without this, the deployed function is missing
  // node_modules/@sparticuz/chromium/bin entirely.
  outputFileTracingIncludes: {
    "/api/nss/generate-pdf": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/nss/generate-reports": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
  // Vanity referral links — friendlier than a raw ?source= query string for
  // partners to share, but resolve to the same landing-page source tracking.
  async redirects() {
    return [
      {
        source: "/hibo",
        destination: "/?source=hibo",
        permanent: false,
      },
      {
        source: "/ByteDance",
        destination: "/?source=jonathan_leder",
        permanent: false,
      },
      {
        source: "/wisLGBT",
        destination: "/?source=wisLGBT",
        permanent: false,
      },
      {
        source: "/atlas",
        destination: "/?source=atlas",
        permanent: false,
      },
      {
        source: "/linkedin",
        destination: "/?source=linkedin",
        permanent: false,
      },
      {
        source: "/friends",
        destination: "/?source=friends_and_family",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
