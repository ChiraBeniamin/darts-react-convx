"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ReactNode } from "react";
import { convex } from "@/lib/convexClient";

type Props = {
  children: ReactNode;
};

/** Client-only auth (no Next middleware): avoids Vercel `MIDDLEWARE_INVOCATION_FAILED` from `headers()` in middleware. Tokens use localStorage. */
export function Providers({ children }: Props) {
  return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>;
}
