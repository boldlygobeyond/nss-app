import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const EXACT_PUBLIC_PATHS = ["/"];
const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/auth",
  "/api/nss/notify-new-user",
  "/api/nss/lead-signup",
  // Pilot/team invite consumption — the recipient isn't logged in yet when
  // they click this link; it signs them in itself via verifyOtp(). The
  // route that *sends* this invite (/api/nss/team-invite) stays admin-gated
  // and off this list on purpose.
  "/team-invite",
  // The email recipient clicking this link isn't logged in — the
  // pdf_download_token in the URL is its own auth, checked inside the
  // route itself, not via Supabase session.
  "/api/nss/report-pdf-download",
  // Resend's servers, not a logged-in user — authenticated via Svix
  // signature verification inside the route itself.
  "/api/nss/resend-webhook",
];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath =
    EXACT_PUBLIC_PATHS.includes(request.nextUrl.pathname) ||
    PUBLIC_PATH_PREFIXES.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!user && !isPublicPath) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
