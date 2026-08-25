import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const loggedIn = Boolean(req.auth);
  const path = nextUrl.pathname;
  const isProtected =
    path.startsWith("/dashboard") || path.startsWith("/onboarding");
  const isAuthPage = path === "/login" || path === "/signup";

  if (isProtected && !loggedIn) {
    const login = new URL("/login", nextUrl.origin);
    login.searchParams.set("callbackUrl", `${path}${nextUrl.search}`);
    return Response.redirect(login);
  }

  if (isAuthPage && loggedIn) {
    return Response.redirect(new URL("/", nextUrl.origin));
  }

  return undefined;
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/onboarding",
    "/onboarding/:path*",
    "/login",
    "/signup",
  ],
};
