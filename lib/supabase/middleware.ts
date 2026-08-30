import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Deny-by-default is right for this app, but it catches the two files a search
// engine asks for before anything else. Without them here, a crawler requesting
// robots.txt is redirected to /login and the site looks unindexable — the
// sitemap never gets read and the disallow rules never apply.
const CRAWLER_PATHS = ["/robots.txt", "/sitemap.xml"];

const PUBLIC_PATHS = [
  "/login",
  // Creating an account and asking for a reset are, by definition, things you
  // do while signed out. Leaving either off this list sends a stranger to
  // /login to prove who they are before they are allowed to become anyone —
  // and /signup is the page paid traffic lands on.
  "/signup",
  "/reset-password",
  "/auth/callback",
  "/auth/confirm",
  "/auth/update-password",
  "/pricing",
  "/terms",
  "/privacy",
  "/welcome",
  ...CRAWLER_PATHS,
];

export async function updateSession(request: NextRequest) {
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
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  // A signed-out visitor at "/" is a stranger, not a locked-out user. Send them
  // the marketing page instead of a sign-in form — this is the only page that
  // describes the product to someone who hasn't bought it, and it is what a
  // crawler indexes as the site's home.
  //
  // A rewrite, not a redirect: the URL stays "/", so the canonical page and the
  // one Google indexes are the same. "/welcome" is disallowed in robots.txt so
  // the rewrite target never competes with "/" in the index.
  if (!user && request.nextUrl.pathname === "/") {
    const welcome = request.nextUrl.clone();
    welcome.pathname = "/welcome";
    return NextResponse.rewrite(welcome);
  }

  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  if (user && request.nextUrl.pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}
