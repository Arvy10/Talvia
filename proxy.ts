import { NextRequest, NextResponse } from "next/server";

import { getSessionCookie } from "better-auth/cookies";

export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/app/:path*"] };
