/**
 * Session Provider Wrapper
 * ========================
 * Wraps the app with NextAuth SessionProvider for authentication.
 * This is a client component that provides session context to all children.
 */
"use client";

import { SessionProvider } from "next-auth/react";

export default function SessionProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SessionProvider>{children}</SessionProvider>;
}

