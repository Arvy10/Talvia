import { auth } from "../../../lib/auth";

export const runtime = "nodejs";

// Calling Better Auth's standard handler directly avoids relying on the
// framework adapter at runtime. The handler is the same implementation used
// by the adapter and keeps this route compatible with the App Router.
export const GET = (request: Request) => auth.handler(request);
export const POST = (request: Request) => auth.handler(request);
