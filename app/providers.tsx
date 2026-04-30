"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ReactNode } from "react";
import { convex } from "@/lib/convexClient";

type Props = {
  children: ReactNode;
};

export function Providers({ children }: Props) {
  return <ConvexAuthNextjsProvider client={convex}>{children}</ConvexAuthNextjsProvider>;
}
