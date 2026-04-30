import type { NextFetchEvent, NextRequest } from "next/server";
import { convexAuthNextjsMiddleware } from "@convex-dev/auth/nextjs/server";

const convexAuth = convexAuthNextjsMiddleware();

/** Next.js 16 `proxy.ts` must export a function named `proxy` (see nextjs.org/docs/app/api-reference/file-conventions/proxy). */
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  return convexAuth(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
