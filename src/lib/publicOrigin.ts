// `new URL(request.url).origin` reflects wherever Next's own server is
// bound (e.g. https://localhost:3000 in dev), not the host the client
// actually connected to — it ignores Host/X-Forwarded-* entirely. That's
// invisible on Vercel (the edge network's public host and Next's own view
// of the request agree), but breaks anything server-generated that needs
// a real client-facing URL — e.g. a link embedded in an email — whenever
// the dev server sits behind a reverse proxy, such as a tunnel used to
// test from another device. Prefer X-Forwarded-Host/-Proto (which a
// proxy sets to the client's real host) and fall back to request.url's
// own origin when they're absent, i.e. no proxy in front at all.
export function getPublicOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${forwardedProto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}
