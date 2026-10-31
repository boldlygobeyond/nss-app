import { describe, it, expect } from "vitest";
import { getPublicOrigin } from "@/lib/publicOrigin";

function makeRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("getPublicOrigin", () => {
  it("prefers X-Forwarded-Host/-Proto when present, over request.url's own origin", () => {
    const request = makeRequest("https://localhost:3000/api/nrs/invite", {
      "x-forwarded-host": "my-tunnel.trycloudflare.com",
      "x-forwarded-proto": "https",
    });
    expect(getPublicOrigin(request)).toBe("https://my-tunnel.trycloudflare.com");
  });

  it("defaults the forwarded protocol to https when X-Forwarded-Proto is missing", () => {
    const request = makeRequest("https://localhost:3000/api/nrs/invite", {
      "x-forwarded-host": "my-tunnel.trycloudflare.com",
    });
    expect(getPublicOrigin(request)).toBe("https://my-tunnel.trycloudflare.com");
  });

  it("falls back to request.url's origin when there's no forwarding proxy", () => {
    const request = makeRequest("https://nova.boldlygobeyond.com/api/nrs/invite");
    expect(getPublicOrigin(request)).toBe("https://nova.boldlygobeyond.com");
  });
});
